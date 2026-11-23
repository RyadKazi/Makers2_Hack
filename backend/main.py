"""FastAPI application replacing the former Express/Prisma API.

The PostgreSQL schema and public /api paths remain compatible with the mobile
client. Database access uses psycopg so the existing Prisma migrations remain
the source of truth.
"""
from __future__ import annotations

import base64
import asyncio
import hashlib
import heapq
import hmac
import html
import json
import math
import os
from pathlib import Path
import re
import secrets
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import bcrypt
import psycopg
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from fastapi.exceptions import RequestValidationError
from xml.etree import ElementTree as ET


DATABASE_URL = os.getenv("DATABASE_URL", "")
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_REFRESH_SECRET = os.getenv("JWT_REFRESH_SECRET", "")
ACCESS_SECONDS = 900
REFRESH_SECONDS = int(os.getenv("JWT_REFRESH_EXPIRES_IN_DAYS", "7")) * 86400
COOKIE = "cw_rt"
API_PREFIX = "/api"
started_at = time.monotonic()
maintenance_task: asyncio.Task | None = None
app = FastAPI(title="CampusWay API", version="1.0.0", docs_url="/docs", openapi_url="/openapi.json")

origins = [v.strip() for v in os.getenv("CORS_ORIGINS", "").split(",") if v.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins or ([] if os.getenv("NODE_ENV") == "production" else ["*"]), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
rate_buckets: dict[tuple[str,str],list[float]] = {}
tts_cache: dict[str,bytes] = {}
planned_routes: dict[str,dict] = {}


async def maintenance_loop():
    while True:
        try:
            execute('UPDATE tracking_sessions SET "endedAt"=LEAST("startedAt"+interval \'3 hours\',("dayKey"::date+1)::timestamp AT TIME ZONE \'Africa/Algiers\'),"endReason"=CASE WHEN "startedAt"+interval \'3 hours\' <= ("dayKey"::date+1)::timestamp AT TIME ZONE \'Africa/Algiers\' THEN \'TIME_LIMIT\'::"SessionEndReason" ELSE \'DAILY_RESET\'::"SessionEndReason" END WHERE "endedAt" IS NULL AND now()>=LEAST("startedAt"+interval \'3 hours\',("dayKey"::date+1)::timestamp AT TIME ZONE \'Africa/Algiers\')')
            execute('DELETE FROM difficulty_events WHERE "recordedAt" < now()-interval \'30 days\'')
            execute('DELETE FROM tracking_sessions WHERE "startedAt" < now()-interval \'30 days\'')
            cutoff=(datetime.now(ZoneInfo("Africa/Algiers")).date()-timedelta(days=30)).isoformat()
            execute('DELETE FROM pseudonym_salts WHERE "dayKey" < %s',(cutoff,))
        except Exception:
            pass
        await asyncio.sleep(30)


@app.on_event("startup")
async def start_maintenance():
    global maintenance_task
    maintenance_task=asyncio.create_task(maintenance_loop())


@app.on_event("shutdown")
async def stop_maintenance():
    if maintenance_task:maintenance_task.cancel()


@app.middleware("http")
async def security_and_rate_limits(request: Request, call_next):
    path=request.url.path
    if path.startswith("/api/"):
        ip=request.client.host if request.client else "unknown"
        window=900 if path in ("/api/auth/login","/api/auth/register") else 60
        speech=path=="/api/speech/tts"
        cap=20 if window==900 else 60 if speech else int(os.getenv("RATE_LIMIT_MAX","300"))
        if speech:window=60
        bucket=rate_buckets.setdefault((ip,str(window)),[]); now=time.monotonic()
        bucket[:]=[stamp for stamp in bucket if stamp>now-window]
        if len(bucket)>=cap:
            return JSONResponse(status_code=429,content={"error":{"code":"RATE_LIMITED","message":"Too many requests. Please try again shortly."}},headers={"ratelimit-limit":str(cap),"ratelimit-remaining":"0"})
        bucket.append(now)
        if len(rate_buckets)>10000:
            for key in list(rate_buckets)[:1000]:rate_buckets.pop(key,None)
    if request.headers.get("content-length") and int(request.headers["content-length"])>1_048_576:
        return JSONResponse(status_code=413,content={"error":{"code":"PAYLOAD_TOO_LARGE","message":"Request body exceeds 1 MB"}})
    response=await call_next(request)
    response.headers["x-content-type-options"]="nosniff"
    response.headers["x-frame-options"]="DENY"
    response.headers["referrer-policy"]="no-referrer"
    response.headers["x-powered-by"]=""
    return response


@contextmanager
def db():
    if not DATABASE_URL:
        raise HTTPException(503, detail={"code": "DATABASE_NOT_CONFIGURED", "message": "DATABASE_URL is required"})
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def one(sql: str, params: tuple = ()) -> dict | None:
    with db() as c:
        return c.execute(sql, params).fetchone()


def many(sql: str, params: tuple = ()) -> list[dict]:
    with db() as c:
        return c.execute(sql, params).fetchall()


def execute(sql: str, params: tuple = ()) -> int:
    with db() as c:
        cur = c.execute(sql, params)
        return cur.rowcount


def jsonable(row: Any) -> Any:
    if isinstance(row, datetime):
        return row.isoformat().replace("+00:00", "Z")
    if isinstance(row, dict):
        return {k: jsonable(v) for k, v in row.items()}
    if isinstance(row, (list, tuple)):
        return [jsonable(v) for v in row]
    return row


def fail(status: int, code: str, message: str, details: Any = None):
    detail = {"code": code, "message": message}
    if details is not None:
        detail["details"] = details
    raise HTTPException(status, detail=detail)


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    issues=[{"path":".".join(str(v) for v in e["loc"][1:]),"message":e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422,content={"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":{"issues":issues}}})


@app.exception_handler(Exception)
async def unhandled_error(_request: Request, exc: Exception):
    # Avoid returning SQL, tokens, coordinates, or provider details to clients.
    return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}})


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def sign(payload: dict, secret: str) -> str:
    if len(secret) < 32:
        fail(503, "AUTH_NOT_CONFIGURED", "JWT secrets must contain at least 32 characters")
    head = _b64(b'{"alg":"HS256","typ":"JWT"}')
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    msg = f"{head}.{body}"
    return f"{msg}.{_b64(hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest())}"


def verify(token: str | None, secret: str) -> dict | None:
    try:
        h, p, sig = token.split(".")
        msg = f"{h}.{p}"
        expected = _b64(hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        claims = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
        return claims if claims.get("exp", 0) > time.time() else None
    except Exception:
        return None


def token_pair(user: dict, response: Response) -> dict:
    jti = str(uuid.uuid4())
    now = int(time.time())
    refresh = sign({"sub": user["id"], "ver": user["tokenVersion"], "jti": jti, "typ": "refresh",
                    "iss": "campusway", "aud": "campusway-refresh", "iat": now, "exp": now + REFRESH_SECONDS}, JWT_REFRESH_SECRET)
    execute('INSERT INTO refresh_sessions ("jtiHash", "userId", "tokenVersion", "expiresAt", "createdAt") VALUES (%s,%s,%s,%s,now())',
            (hashlib.sha256(jti.encode()).hexdigest(), user["id"], user["tokenVersion"], datetime.now(timezone.utc) + timedelta(seconds=REFRESH_SECONDS)))
    response.set_cookie(COOKIE, refresh, max_age=REFRESH_SECONDS, httponly=True,
                        secure=os.getenv("NODE_ENV") == "production", samesite="strict", path="/api/auth")
    now = int(time.time())
    access = sign({"sub": user["id"], "role": user["role"], "typ": "access", "iss": "campusway",
                   "aud": "campusway-api", "iat": now, "exp": now + ACCESS_SECONDS}, JWT_SECRET)
    profile = profile_dto(one('SELECT * FROM accessibility_profiles WHERE "userId"=%s', (user["id"],)))
    me = {k: user[k] for k in ("id", "email", "displayName", "role", "locale", "createdAt")}
    me["createdAt"] = jsonable(me["createdAt"])
    me["accessibilityProfile"] = profile
    return {"accessToken": access, "tokenType": "Bearer", "expiresIn": ACCESS_SECONDS, "user": me}


def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        fail(401, "UNAUTHORIZED", "Authentication required")
    claims = verify(authorization[7:].strip(), JWT_SECRET)
    if not claims or claims.get("typ") != "access" or claims.get("iss") != "campusway" or claims.get("aud") != "campusway-api":
        fail(401, "INVALID_TOKEN", "Access token is invalid or expired")
    user = one('SELECT id,email,"displayName",role,locale,"tokenVersion","createdAt" FROM users WHERE id=%s', (claims.get("userId"),))
    if not user or user["role"] != claims.get("role"):
        fail(401, "UNKNOWN_USER", "This account no longer exists")
    return user


def roles(*allowed: str):
    def check(user: dict = Depends(current_user)):
        if user["role"] not in allowed:
            fail(403, "FORBIDDEN", "You do not have permission to perform this action")
        return user
    return check


def profile_dto(row: dict | None) -> dict:
    default = {"mobility": "NONE", "stepFree": False, "requireVerifiedRamps": False, "maxSlopePercent": None,
        "minPassageWidthCm": None, "avoidClosedPassages": True, "audioGuidance": False, "shorelineHints": False,
        "captions": False, "textToSpeech": False, "highContrast": False, "reducedMotion": False,
        "textScale": 1, "updatedAt": None}
    if row:
        default.update({k: row[k] for k in default if k in row})
        default["updatedAt"] = jsonable(row["updatedAt"])
    return default


class Register(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    displayName: str = Field(min_length=1, max_length=80)
    locale: str = "fr"


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str


class UpdateMe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    displayName: str | None = Field(default=None, min_length=1, max_length=80)
    locale: str | None = None


PROFILE_FIELDS = {"mobility", "stepFree", "requireVerifiedRamps", "maxSlopePercent", "minPassageWidthCm",
                  "avoidClosedPassages", "audioGuidance", "shorelineHints", "captions", "textToSpeech",
                  "highContrast", "reducedMotion", "textScale"}


@app.get("/health")
def health():
    try:
        one("SELECT 1")
        dbup = True
    except Exception:
        dbup = False
    return JSONResponse(status_code=200 if dbup else 503, content={"status": "ok" if dbup else "degraded",
        "service": "campusway-server", "uptimeS": round(time.monotonic()-started_at),
        "checks": {"database": "up" if dbup else "down"}, "time": datetime.now(timezone.utc).isoformat()})


@app.post("/api/auth/register", status_code=201)
def register(data: Register, response: Response):
    email = data.email.strip().lower()
    if data.locale not in ("ar", "fr", "en"):
        fail(422, "VALIDATION_ERROR", "locale must be ar, fr or en")
    uid = "c" + uuid.uuid4().hex[:24]
    try:
        execute('INSERT INTO users (id,email,"passwordHash","displayName",role,locale,"createdAt","updatedAt") VALUES (%s,%s,%s,%s,\'STUDENT\',%s,now(),now())',
                (uid, email, bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=int(os.getenv("BCRYPT_ROUNDS", "11")))).decode(), data.displayName.strip(), data.locale))
    except psycopg.errors.UniqueViolation:
        fail(409, "EMAIL_TAKEN", "An account already exists for this email")
    user = one('SELECT id,email,"displayName",role,locale,"tokenVersion","createdAt" FROM users WHERE id=%s', (uid,))
    return token_pair(user, response)


@app.post("/api/auth/login")
def login(data: Login, response: Response):
    user = one('SELECT id,email,"passwordHash","displayName",role,locale,"tokenVersion","createdAt" FROM users WHERE email=%s', (data.email.strip().lower(),))
    ph = (user["passwordHash"] if user else "$2b$11$C6UzMDM.H6dfI/f/IKcEe.1t5U8MZ.8UYV4ZlC2xV6tR5Q6U0V5yK")
    try:
        valid = bcrypt.checkpw(data.password.encode(), ph.encode())
    except ValueError:
        valid = False
    if not user or not valid:
        fail(401, "INVALID_CREDENTIALS", "Invalid email or password")
    return token_pair(user, response)


@app.post("/api/auth/refresh")
def refresh(response: Response, cookie: str | None = Cookie(default=None, alias=COOKIE)):
    claims = verify(cookie, JWT_REFRESH_SECRET)
    if claims and (claims.get("typ") != "refresh" or claims.get("iss") != "campusway" or claims.get("aud") != "campusway-refresh"):
        claims = None
    session = None
    if claims:
        session = one('SELECT * FROM refresh_sessions WHERE "jtiHash"=%s', (hashlib.sha256(claims["jti"].encode()).hexdigest(),))
    if not claims or not session or session["userId"] != claims.get("sub") or session["tokenVersion"] != claims.get("ver") or session["expiresAt"] <= datetime.now(timezone.utc):
        response.delete_cookie(COOKIE, path="/api/auth")
        fail(401, "INVALID_REFRESH_TOKEN", "Session expired, please sign in again")
    execute('DELETE FROM refresh_sessions WHERE "jtiHash"=%s', (session["jtiHash"],))
    user = one('SELECT id,email,"displayName",role,locale,"tokenVersion","createdAt" FROM users WHERE id=%s', (session["userId"],))
    return token_pair(user, response)


@app.post("/api/auth/logout")
def logout(response: Response, cookie: str | None = Cookie(default=None, alias=COOKIE)):
    claims = verify(cookie, JWT_REFRESH_SECRET)
    if claims and claims.get("typ") == "refresh" and claims.get("iss") == "campusway" and claims.get("aud") == "campusway-refresh":
        execute('DELETE FROM refresh_sessions WHERE "jtiHash"=%s', (hashlib.sha256(claims["jti"].encode()).hexdigest(),))
    response.delete_cookie(COOKIE, path="/api/auth")
    return {"success": True}


@app.post("/api/auth/logout-all")
def logout_all(response: Response, user=Depends(current_user)):
    with db() as c:
        c.execute('DELETE FROM refresh_sessions WHERE "userId"=%s', (user["id"],))
        c.execute('UPDATE users SET "tokenVersion"="tokenVersion"+1 WHERE id=%s', (user["id"],))
    response.delete_cookie(COOKIE, path="/api/auth")
    return {"success": True}


@app.get("/api/me")
def get_me(user=Depends(current_user)):
    user["createdAt"] = jsonable(user["createdAt"])
    user["accessibilityProfile"] = profile_dto(one('SELECT * FROM accessibility_profiles WHERE "userId"=%s', (user["id"],)))
    user.pop("tokenVersion", None)
    return user


@app.put("/api/me")
def update_me(data: UpdateMe, user=Depends(current_user)):
    updates = data.model_dump(exclude_unset=True)
    if "locale" in updates and updates["locale"] not in ("ar", "fr", "en"):
        fail(422, "VALIDATION_ERROR", "locale must be ar, fr or en")
    if updates:
        cols = {"displayName": '"displayName"', "locale": "locale"}
        sets = [f"{cols[k]}=%s" for k in updates]
        execute(f'UPDATE users SET {", ".join(sets)}, "updatedAt"=now() WHERE id=%s', (*updates.values(), user["id"]))
    return get_me(user)


@app.get("/api/me/accessibility-profile")
def get_profile(user=Depends(current_user)):
    return profile_dto(one('SELECT * FROM accessibility_profiles WHERE "userId"=%s', (user["id"],)))


@app.put("/api/me/accessibility-profile")
async def update_profile(request: Request, user=Depends(current_user)):
    payload = await request.json()
    if not isinstance(payload, dict) or set(payload) - PROFILE_FIELDS:
        fail(422, "VALIDATION_ERROR", "Invalid accessibility profile fields")
    existing = one('SELECT * FROM accessibility_profiles WHERE "userId"=%s', (user["id"],))
    merged = profile_dto(existing)
    merged.update(payload)
    # Map the client camelCase field names to Prisma's quoted SQL columns.
    sqlnames = {"userId": '"userId"', **{k: f'"{k}"' for k in PROFILE_FIELDS}}
    if existing:
        execute('UPDATE accessibility_profiles SET ' + ','.join(f'{sqlnames[k]}=%s' for k in payload) + ',"updatedAt"=now() WHERE "userId"=%s', (*payload.values(), user["id"]))
    else:
        keys = list(merged)
        execute('INSERT INTO accessibility_profiles (id,"userId",' + ','.join(sqlnames[k] for k in keys) + ',"updatedAt") VALUES (%s,%s,' + ','.join(['%s']*len(keys)) + ',now())', ("c"+uuid.uuid4().hex[:24], user["id"], *(merged[k] for k in keys)))
    return get_profile(user)


def building_dto(row):
    floors=many('SELECT f.id,f.level,f.name,f."elevationM",count(r.id)::int AS "roomCount" FROM floors f LEFT JOIN rooms r ON r."floorId"=f.id WHERE f."buildingId"=%s GROUP BY f.id ORDER BY f.level',(row["id"],))
    return {"id":row["id"],"code":row["code"],"name":row["name"],"nameAr":row["nameAr"],"x":row["x"],"y":row["y"],"footprint":json.loads(row["footprint"]) if row.get("footprint") else None,"floors":floors}


@app.get("/api/campus/")
def campus_overview():
    campus=one('SELECT id,name,"nameAr",timezone,ST_AsGeoJSON(geofence) AS geofence FROM campuses ORDER BY id LIMIT 1')
    if not campus:fail(404,"NOT_FOUND","Campus is not configured")
    bs=many('SELECT b.id,b.code,b.name,b."nameAr",b.x,b.y,ST_AsGeoJSON(b.footprint) AS footprint FROM buildings b ORDER BY b.code')
    all_buildings=[building_dto(b) for b in bs]
    points=many('SELECT id,level,type::text AS type,name,"nameAr",accessible,notes,x,y,"navNodeId",ST_AsGeoJSON(geom) AS geometry FROM pois WHERE "floorId" IS NULL ORDER BY name')
    entrances=[];ramps=[];facilities=[]
    for p in points:
        typ=p["type"];layer="entrances" if typ in ("ENTRANCE","ACCESSIBLE_ENTRANCE") else "ramps" if typ=="RAMP" else "facilities"
        item={"type":"Feature","id":p["id"],"geometry":json.loads(p["geometry"]) if p["geometry"] else None,"properties":{"layer":layer,"type":typ,"name":p["name"],"nameAr":p["nameAr"],"accessible":p["accessible"],"notes":p["notes"],"level":p["level"],"navNodeId":p["navNodeId"]}}
        (entrances if layer=="entrances" else ramps if layer=="ramps" else facilities).append(item)
    bounds=one('SELECT min(x) AS minx,min(y) AS miny,max(x) AS maxx,max(y) AS maxy FROM (SELECT x,y FROM buildings UNION ALL SELECT x,y FROM pois WHERE "floorId" IS NULL) p')
    return {"campus":{k:campus[k] for k in ("id","name","nameAr","timezone")},"bounds":[bounds["minx"],bounds["miny"],bounds["maxx"],bounds["maxy"]] if bounds else [0,0,0,0],"geofence":json.loads(campus["geofence"]) if campus["geofence"] else None,"buildings":all_buildings,"outdoor":{"entrances":{"type":"FeatureCollection","features":entrances},"ramps":{"type":"FeatureCollection","features":ramps},"facilities":{"type":"FeatureCollection","features":facilities},"walls":{"type":"FeatureCollection","features":[]},"passages":{"type":"FeatureCollection","features":[]}}}


@app.get("/api/campus/buildings")
def buildings():
    return {"items":[building_dto(b) for b in many('SELECT b.id,b.code,b.name,b."nameAr",b.x,b.y,ST_AsGeoJSON(b.footprint) AS footprint FROM buildings b ORDER BY b.code')]}


@app.get("/api/campus/buildings/{building_id}/floors")
def building_floors(building_id: str):
    building = one('SELECT id,code,name,"nameAr" FROM buildings WHERE id=%s OR code=%s', (building_id,building_id))
    if not building:
        fail(404, "NOT_FOUND", "Building not found")
    floors = many('SELECT f.id,f.level,f.name,f."elevationM",count(r.id)::int AS "roomCount" FROM floors f LEFT JOIN rooms r ON r."floorId"=f.id WHERE f."buildingId"=%s GROUP BY f.id ORDER BY f.level', (building["id"],))
    return {"building": {k:building[k] for k in ("id","code","name","nameAr")}, "items": floors}


@app.get("/api/campus/floors/{floor_id}")
def floor_plan(floor_id: str, lang: str = "fr"):
    floor = one('SELECT f.id,f."buildingId",f.level,f.name,f."elevationM",ST_AsGeoJSON(f.outline) AS outline,b.code AS "buildingCode",b.name AS "buildingName",b."nameAr" AS "buildingNameAr" FROM floors f JOIN buildings b ON b.id=f."buildingId" WHERE f.id=%s', (floor_id,))
    if not floor:fail(404, "NOT_FOUND", "Floor not found")
    rooms=many('SELECT id,code,name,"nameAr",type::text AS type,capacity,"wheelchairSpaces","hearingLoop",x,y,ST_AsGeoJSON(coalesce(shape,geom)) AS geometry FROM rooms WHERE "floorId"=%s ORDER BY code',(floor_id,))
    room_features=[];now=datetime.now(timezone.utc)
    labels={"en":{"AVAILABLE":"Available","TEACHER":"Teaching","ADMIN":"Administration","CLUB":"Club"},"fr":{"AVAILABLE":"Disponible","TEACHER":"Cours","ADMIN":"Administration","CLUB":"Club"},"ar":{"AVAILABLE":"متاح","TEACHER":"درس","ADMIN":"إدارة","CLUB":"نادي"}}
    for r in rooms:
        active=one('SELECT id,kind,title,organizer,"endsAt" FROM reservations WHERE "roomId"=%s AND "startsAt"<=%s AND "endsAt">%s ORDER BY "startsAt" LIMIT 1',(r["id"],now,now))
        upcoming=one('SELECT "startsAt" FROM reservations WHERE "roomId"=%s AND "startsAt">%s ORDER BY "startsAt" LIMIT 1',(r["id"],now)) if not active else None
        state=active["kind"] if active else "AVAILABLE"
        rstatus={"status":state,"label":labels.get(lang,labels["fr"]).get(state,state),"occupantName":active["organizer"] if active else None,"title":active["title"] if active else None,"reservationId":active["id"] if active else None,"until":jsonable(active["endsAt"] if active else upcoming["startsAt"] if upcoming else None),"freeAt":jsonable(active["endsAt"] if active else now)}
        room_features.append({"type":"Feature","id":r["id"],"geometry":json.loads(r["geometry"]) if r["geometry"] else None,"properties":{"layer":"rooms","code":r["code"],"name":r["name"],"nameAr":r["nameAr"],"type":r["type"],"capacity":r["capacity"],"wheelchairSpaces":r["wheelchairSpaces"],"hearingLoop":r["hearingLoop"],"status":rstatus}})
    pois=many('SELECT id,level,type::text AS type,name,"nameAr",accessible,notes,x,y,"navNodeId",ST_AsGeoJSON(geom) AS geometry FROM pois WHERE "floorId"=%s ORDER BY name',(floor_id,))
    poi_layers={"ENTRANCE":"entrances","ACCESSIBLE_ENTRANCE":"entrances","ELEVATOR":"elevators","STAIRS":"stairs","RAMP":"ramps","TOILET":"toilets","ACCESSIBLE_TOILET":"accessible_toilets","FACILITY":"facilities","INFO_DESK":"facilities","PARKING_ACCESSIBLE":"facilities"}
    layers={name:{"type":"FeatureCollection","features":[]} for name in ("rooms","walls","passages","entrances","elevators","stairs","ramps","toilets","accessible_toilets","facilities")}
    layers["rooms"]["features"]=room_features
    for p in pois:
        layer=poi_layers[p["type"]]
        layers[layer]["features"].append({"type":"Feature","id":p["id"],"geometry":json.loads(p["geometry"]) if p["geometry"] else None,"properties":{"layer":layer,"type":p["type"],"name":p["name"],"nameAr":p["nameAr"],"accessible":p["accessible"],"notes":p["notes"],"level":p["level"],"navNodeId":p["navNodeId"]}})
    walls=many('SELECT id,kind::text AS kind,label,ST_AsGeoJSON(geom) AS geometry FROM walls WHERE "floorId"=%s ORDER BY id',(floor_id,))
    layers["walls"]["features"]=[{"type":"Feature","id":w["id"],"geometry":json.loads(w["geometry"]) if w["geometry"] else None,"properties":{"layer":"walls","kind":w["kind"],"label":w["label"]}} for w in walls]
    passages=many('SELECT e.id,e."isOpen",e."closedReason",e."hasStairs",e."stepCount",e."isRamp",e."slopePercent",e."widthCm",e."doorClearanceCm",e.surface::text AS surface,e.verified,ST_AsGeoJSON(e.geom) AS geometry FROM nav_edges e JOIN nav_nodes a ON a.id=e."fromId" JOIN nav_nodes b ON b.id=e."toId" WHERE a."floorId"=%s OR b."floorId"=%s ORDER BY e.id',(floor_id,floor_id))
    layers["passages"]["features"]=[{"type":"Feature","id":e["id"],"geometry":json.loads(e["geometry"]) if e["geometry"] else None,"properties":{"layer":"passages",**{k:e[k] for k in ("isOpen","closedReason","hasStairs","stepCount","isRamp","slopePercent","widthCm","doorClearanceCm","surface","verified")}}} for e in passages]
    bounds=one('SELECT min(x) AS minx,min(y) AS miny,max(x) AS maxx,max(y) AS maxy FROM (SELECT x,y FROM rooms WHERE "floorId"=%s UNION ALL SELECT x,y FROM pois WHERE "floorId"=%s UNION ALL SELECT n.x,n.y FROM nav_nodes n WHERE n."floorId"=%s) t',(floor_id,floor_id,floor_id))
    b=[bounds["minx"],bounds["miny"],bounds["maxx"],bounds["maxy"]] if bounds["minx"] is not None else [0,0,0,0]
    return {"floor":{"id":floor["id"],"level":floor["level"],"name":floor["name"],"elevationM":floor["elevationM"],"building":{"id":floor["buildingId"],"code":floor["buildingCode"],"name":floor["buildingName"],"nameAr":floor["buildingNameAr"]}},"bounds":b,"outline":json.loads(floor["outline"]) if floor["outline"] else None,"layers":layers,"at":jsonable(now)}


@app.get("/api/campus/floors/{floor_id}/layers")
def floor_layers(floor_id: str, types: str | None = None):
    plan = floor_plan(floor_id)
    selected = set(types.split(",")) if types else set(plan["layers"])
    return {"floorId": floor_id,"layers":{k:v for k,v in plan["layers"].items() if k in selected},"at":plan["at"]}


@app.get("/api/rooms")
def room_list(search: str | None = None, status: str | None = None, buildingId: str | None = None, floor: int | None = None, minCapacity: int | None = None, stepFree: bool | None = None, limit: int = 100, offset: int = 0, lang: str = "fr"):
    where = ["1=1"]
    params: list[Any] = []
    if search:
        where.append('(lower(r.name) LIKE lower(%s) OR lower(r.code) LIKE lower(%s) OR lower(coalesce(r."nameAr",\'\')) LIKE lower(%s) OR lower(b.name) LIKE lower(%s))')
        params.extend([f"%{search}%"]*4)
    if buildingId:
        where.append('f."buildingId"=%s'); params.append(buildingId)
    if floor is not None:
        where.append('f.level=%s'); params.append(floor)
    if minCapacity is not None:
        where.append('r.capacity >= %s'); params.append(minCapacity)
    rows = many('SELECT r.id,r."floorId",r.code,r.name,r."nameAr",r.type::text AS type,r.capacity,r."wheelchairSpaces",r."hearingLoop",r."doorNodeId",r.x,r.y,f.level,f.name AS "floorName",f."buildingId",b.code AS "buildingCode",b.name AS "buildingName",b."nameAr" AS "buildingNameAr" FROM rooms r JOIN floors f ON f.id=r."floorId" JOIN buildings b ON b.id=f."buildingId" WHERE ' + ' AND '.join(where) + ' ORDER BY r.code', tuple(params))
    now = datetime.now(timezone.utc)
    labels={"en":{"AVAILABLE":"Available","TEACHER":"Teaching","ADMIN":"Administration","CLUB":"Club"},"fr":{"AVAILABLE":"Disponible","TEACHER":"Cours","ADMIN":"Administration","CLUB":"Club"},"ar":{"AVAILABLE":"متاح","TEACHER":"درس","ADMIN":"إدارة","CLUB":"نادي"}}
    graph_nodes,graph_edges=route_graph()
    entries=[n["id"] for n in graph_nodes.values() if n["kind"]=="ENTRANCE" and n["floorId"] is None]
    for r in rows:
        reservation = one('SELECT id,kind,title,organizer,"startsAt","endsAt" FROM reservations WHERE "roomId"=%s AND "startsAt"<=%s AND "endsAt">%s ORDER BY "startsAt" LIMIT 1', (r["id"], now, now))
        status_code=reservation["kind"] if reservation else "AVAILABLE"
        next_res=one('SELECT "startsAt" FROM reservations WHERE "roomId"=%s AND "startsAt">%s ORDER BY "startsAt" LIMIT 1',(r["id"],now)) if not reservation else None
        until=reservation["endsAt"] if reservation else (next_res["startsAt"] if next_res else None)
        r["status"]={"status":status_code,"label":labels.get(lang,labels["fr"]).get(status_code,status_code),"occupantName":reservation["organizer"] if reservation else None,"title":reservation["title"] if reservation else None,"reservationId":reservation["id"] if reservation else None,"until":jsonable(until),"freeAt":jsonable(reservation["endsAt"] if reservation else now)}
        door=r.pop("doorNodeId")
        r["stepFreeAccess"]=bool(door and any(dijkstra(graph_nodes,graph_edges,entry,door,{"avoidEdgeIds":[]},True) for entry in entries))
    if status:
        allowed=set(status.split(","));rows=[r for r in rows if r["status"]["status"] in allowed]
    if stepFree is True: rows=[r for r in rows if r["stepFreeAccess"]]
    total=len(rows); rows=rows[offset:offset+min(max(limit,1),200)]
    items=[]
    for r in rows:
        items.append({"id":r["id"],"code":r["code"],"name":r["name"],"nameAr":r["nameAr"],"type":r["type"],"capacity":r["capacity"],"wheelchairSpaces":r["wheelchairSpaces"],"hearingLoop":r["hearingLoop"],"building":{"id":r["buildingId"],"code":r["buildingCode"],"name":r["buildingName"],"nameAr":r["buildingNameAr"]},"floor":{"id":r["floorId"],"level":r["level"],"name":r["floorName"]},"x":r["x"],"y":r["y"],"stepFreeAccess":r["stepFreeAccess"],"status":r["status"]})
    return {"items":items,"total":total,"at":jsonable(now)}


@app.get("/api/rooms/{room_id}")
def room_detail(room_id: str, lang: str = "fr"):
    items = room_list(lang=lang)
    room = next((r for r in items["items"] if r["id"] == room_id), None)
    if not room:
        allrooms=room_list(search=room_id,lang=lang)
        room=next((r for r in allrooms["items"] if r["id"]==room_id or r["code"].lower()==room_id.lower()),None)
    if not room:
        fail(404, "NOT_FOUND", "Room not found")
    now = datetime.now(timezone.utc)
    actual=one('SELECT id FROM rooms WHERE id=%s OR code=%s',(room_id,room_id))
    if not actual:fail(404,"NOT_FOUND","Room not found")
    room["schedule"] = many('SELECT id,kind,"startsAt","endsAt" FROM reservations WHERE "roomId"=%s AND "endsAt">=%s ORDER BY "startsAt" LIMIT 30', (actual["id"], now))
    door=one('SELECT "doorNodeId" FROM rooms WHERE id=%s',(actual["id"],))
    clearance=one('SELECT min(e."doorClearanceCm") AS clearance FROM nav_edges e WHERE e."fromId"=%s OR e."toId"=%s',(door["doorNodeId"],door["doorNodeId"])) if door and door["doorNodeId"] else None
    room["accessibility"]={"stepFreeAccess":room["stepFreeAccess"],"wheelchairAccessible":room["stepFreeAccess"] and (clearance or {}).get("clearance",0)>=80 and room["wheelchairSpaces"]>0,"doorClearanceCm":(clearance or {}).get("clearance"),"wheelchairSpaces":room["wheelchairSpaces"],"hearingLoop":room["hearingLoop"]}
    room["nearest"]={"elevator":None,"accessibleToilet":None}
    return room


def reservation_dto(r: dict) -> dict:
    for key in ("startsAt","endsAt","createdAt"):
        if key in r:r[key]=jsonable(r[key])
    return r


@app.get("/api/reservations")
def reservations(user=Depends(current_user), from_: datetime | None = Query(default=None, alias="from"), to: datetime | None = None, roomId: str | None = None, kind: str | None = None, mine: bool = False):
    start = from_ or datetime.now(ZoneInfo("Africa/Algiers")).replace(hour=0,minute=0,second=0,microsecond=0).astimezone(timezone.utc)
    end = to or start + timedelta(days=30)
    if end<=start or end-start>timedelta(days=31):fail(400,"INVALID_RANGE","Reservation range must be positive and no more than 31 days")
    clauses=['r."startsAt"<%s','r."endsAt">%s'];params=[end,start]
    if roomId:clauses.append('r."roomId"=%s');params.append(roomId)
    if kind:clauses.append('r.kind::text=%s');params.append(kind)
    if user["role"]!="ADMIN" or mine:clauses.append('r."userId"=%s');params.append(user["id"])
    rows=many('SELECT r.id,r."roomId",rm.code AS "roomCode",r.kind,r.title,r.organizer,r."startsAt",r."endsAt" FROM reservations r JOIN rooms rm ON rm.id=r."roomId" WHERE '+' AND '.join(clauses)+' ORDER BY r."startsAt",r."roomId" LIMIT 1000',tuple(params))
    return {"items":[reservation_dto(r) for r in rows],"from":jsonable(start),"to":jsonable(end)}


@app.get("/api/reservations/{reservation_id}")
def reservation_get(reservation_id: str, user=Depends(current_user)):
    r = one('SELECT * FROM reservations WHERE id=%s', (reservation_id,))
    if not r: fail(404, "NOT_FOUND", "Reservation not found")
    if user["role"]!="ADMIN" and r["userId"]!=user["id"]:fail(403,"FORBIDDEN","You can only view reservations you created")
    room=one('SELECT code FROM rooms WHERE id=%s',(r["roomId"],));r["roomCode"]=room["code"] if room else ""
    return {k:v for k,v in reservation_dto(r).items() if k in ("id","roomId","roomCode","kind","title","organizer","startsAt","endsAt")}


class ReservationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    roomId: str
    kind: str = "TEACHER"
    title: str = Field(min_length=3, max_length=120)
    organizer: str | None = Field(default=None, min_length=2, max_length=80)
    startsAt: datetime
    endsAt: datetime


class ReservationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    roomId: str | None = None
    title: str | None = Field(default=None, min_length=3, max_length=120)
    organizer: str | None = Field(default=None, min_length=2, max_length=80)
    startsAt: datetime | None = None
    endsAt: datetime | None = None


def check_reservation(body: ReservationBody, user: dict, rid: str | None = None):
    if body.kind not in ("TEACHER", "ADMIN", "CLUB"):
        fail(422, "VALIDATION_ERROR", "Invalid reservation kind")
    duration = (body.endsAt - body.startsAt).total_seconds()
    if duration < 900 or duration > 43200 or body.endsAt <= body.startsAt:
        fail(422, "INVALID_INTERVAL", "Duration must be between 15 minutes and 12 hours")
    if body.startsAt < datetime.now(timezone.utc):fail(400,"INVALID_INTERVAL","A reservation cannot start in the past")
    if not one('SELECT id FROM rooms WHERE id=%s', (body.roomId,)):
        fail(404, "NOT_FOUND", "Room not found")
    conflict = many('SELECT id,"startsAt","endsAt" FROM reservations WHERE "roomId"=%s AND "startsAt"<%s AND "endsAt">%s AND id<>coalesce(%s,\'\')', (body.roomId, body.endsAt, body.startsAt, rid))
    if conflict:
        fail(409, "RESERVATION_CONFLICT", "Room is already reserved during that time", {"conflicts": jsonable(conflict)})


@app.post("/api/reservations", status_code=201)
def reservation_create(body: ReservationBody, user=Depends(roles("TEACHER", "ADMIN", "CLUB"))):
    check_reservation(body, user)
    if user["role"] != "ADMIN" and body.kind == "ADMIN": fail(403, "FORBIDDEN", "Only admins create admin reservations")
    if body.kind=="TEACHER" and user["role"] not in ("TEACHER","ADMIN"):fail(403,"FORBIDDEN","Only teachers create teaching reservations")
    me=one('SELECT "displayName" FROM users WHERE id=%s',(user["id"],))
    organizer=body.organizer or me["displayName"]
    if user["role"]=="TEACHER" and body.kind=="TEACHER" and organizer!=me["displayName"]:fail(403,"FORBIDDEN","Teaching reservations use your account name")
    if body.kind=="CLUB" and not body.organizer:fail(422,"VALIDATION_ERROR","A club name is required for CLUB reservations")
    rid = "c"+uuid.uuid4().hex[:24]
    execute('INSERT INTO reservations (id,"roomId",kind,title,organizer,"userId","startsAt","endsAt","createdAt") VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now())',
            (rid, body.roomId, body.kind, body.title.strip(), organizer.strip(), user["id"], body.startsAt, body.endsAt))
    return reservation_get(rid, user)


@app.patch("/api/reservations/{reservation_id}")
def reservation_update(reservation_id: str, body: ReservationUpdate, user=Depends(roles("TEACHER", "ADMIN", "CLUB"))):
    old = one('SELECT * FROM reservations WHERE id=%s', (reservation_id,))
    if not old: fail(404, "NOT_FOUND", "Reservation not found")
    if user["role"] != "ADMIN" and old["userId"] != user["id"]: fail(403, "FORBIDDEN", "You can only change your own reservations")
    if old["endsAt"] < datetime.now(timezone.utc): fail(409, "RESERVATION_ENDED", "Ended reservations are read-only")
    updates=body.model_dump(exclude_unset=True)
    if not updates:fail(400,"VALIDATION_ERROR","Provide at least one field")
    merged={"roomId":old["roomId"],"kind":old["kind"],"title":old["title"],"organizer":old["organizer"],"startsAt":old["startsAt"],"endsAt":old["endsAt"],**updates}
    if merged["startsAt"].tzinfo is None:merged["startsAt"]=merged["startsAt"].replace(tzinfo=timezone.utc)
    if merged["endsAt"].tzinfo is None:merged["endsAt"]=merged["endsAt"].replace(tzinfo=timezone.utc)
    check_reservation(ReservationBody(**merged), user, reservation_id)
    execute('UPDATE reservations SET "roomId"=%s,title=%s,organizer=%s,"startsAt"=%s,"endsAt"=%s WHERE id=%s', (merged["roomId"], merged["title"], merged["organizer"], merged["startsAt"], merged["endsAt"], reservation_id))
    return reservation_get(reservation_id, user)


@app.delete("/api/reservations/{reservation_id}")
def reservation_delete(reservation_id: str, user=Depends(roles("TEACHER", "ADMIN", "CLUB"))):
    old = one('SELECT * FROM reservations WHERE id=%s', (reservation_id,))
    if not old: fail(404, "NOT_FOUND", "Reservation not found")
    if user["role"] != "ADMIN" and old["userId"] != user["id"]: fail(403, "FORBIDDEN", "You can only cancel your own reservations")
    if old["endsAt"] < datetime.now(timezone.utc): fail(409, "RESERVATION_ENDED", "Ended reservations cannot be cancelled")
    execute('DELETE FROM reservations WHERE id=%s', (reservation_id,))
    return {"success": True}


@app.get("/api/ai/health")
def ai_health():
    import urllib.request
    base = os.getenv("ACCESU_NAVIGATION_URL", "http://127.0.0.1:8000").rstrip("/")
    try:
        with urllib.request.urlopen(base + "/api/v1/health", timeout=3) as r:
            data = json.loads(r.read())
        return {"reachable": True, "status": data.get("data", {}).get("status", "ok"), "version": data.get("data", {}).get("version", "unknown")}
    except Exception:
        fail(502, "AI_SERVICE_UNAVAILABLE", "Navigation service could not be reached")


@app.post("/api/ai/route")
async def ai_route(request: Request):
    payload = await request.json()
    key = os.getenv("ACCESU_NAVIGATION_API_KEY")
    if not key: fail(503, "AI_SERVICE_NOT_CONFIGURED", "Navigation service is not configured")
    import urllib.request
    req = urllib.request.Request(os.getenv("ACCESU_NAVIGATION_URL", "http://127.0.0.1:8000").rstrip("/")+"/api/v1/navigation/route",
        data=json.dumps(payload).encode(), headers={"content-type":"application/json","authorization":f"Bearer {key}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r: result=json.loads(r.read())
    except Exception:
        fail(502, "AI_SERVICE_UNAVAILABLE", "Navigation service could not be reached")
    d=result.get("data",{})
    return {"success":True,"message":result.get("message","Route calculated"),"route":{"nodes":d.get("route",[]),"total_distance":d.get("total_distance",0),"floor_transitions":d.get("floor_transitions",[]),"profile":payload.get("profile"),"node_details":d.get("nodes",[]),"edges":d.get("edges",[])}}


@app.get("/api/speech/status")
def speech_status():
    configured = bool(os.getenv("CARTESIA_API_KEY"))
    voices = {"ar":os.getenv("CARTESIA_VOICE_ID_AR"),"fr":os.getenv("CARTESIA_VOICE_ID_FR"),"en":os.getenv("CARTESIA_VOICE_ID_EN")}
    voice=bool(os.getenv("CARTESIA_VOICE_ID"))
    return {"tts":{"available":configured and (any(voices.values()) or voice),"provider":"cartesia","model":os.getenv("CARTESIA_TTS_MODEL","sonic-3.6"),"languages":[k for k,v in voices.items() if configured and (v or voice)],"maxChars":600}}


@app.post("/api/speech/tts")
async def speech_tts(request: Request, user=Depends(current_user)):
    body=await request.json(); text=body.get("text","").strip(); lang=body.get("lang"); speed=body.get("speed",1)
    if not text or len(text)>600 or lang not in ("ar","fr","en") or not .6<=speed<=1.5:
        fail(422,"VALIDATION_ERROR","Invalid text, language or speed")
    key=os.getenv("CARTESIA_API_KEY"); voice=os.getenv("CARTESIA_VOICE_ID_"+lang.upper()) or os.getenv("CARTESIA_VOICE_ID")
    if not key or not voice: fail(503,"TTS_UNAVAILABLE","No voice is configured for this language")
    cache_key=hashlib.sha256(json.dumps([os.getenv("CARTESIA_TTS_MODEL","sonic-3.6"),voice,lang,speed," ".join(text.split())]).encode()).hexdigest()
    if cache_key in tts_cache:return Response(tts_cache[cache_key],media_type="audio/mpeg",headers={"cache-control":"private, max-age=86400","x-tts-cache":"hit"})
    import urllib.request
    payload={"model_id":os.getenv("CARTESIA_TTS_MODEL","sonic-3.6"),"transcript":" ".join(text.split()),"voice":{"id":voice},"language":lang,"output_format":{"container":"mp3","sample_rate":44100,"bit_rate":128000}}
    if speed!=1:payload["generation_config"]={"speed":speed}
    data=json.dumps(payload).encode()
    req=urllib.request.Request(os.getenv("CARTESIA_API_URL","https://api.cartesia.ai").rstrip("/")+"/tts/bytes",data=data,headers={"content-type":"application/json","authorization":f"Bearer {key}","cartesia-version":os.getenv("CARTESIA_VERSION","2026-08-14")},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=30) as r: audio=r.read()
    except Exception: fail(502,"TTS_PROVIDER_ERROR","Speech provider request failed")
    if len(audio)<7_500_000:tts_cache[cache_key]=audio
    while len(tts_cache)>300:tts_cache.pop(next(iter(tts_cache)))
    return Response(audio,media_type="audio/mpeg",headers={"cache-control":"private, max-age=86400","x-tts-cache":"miss"})


@app.get("/api/campus/search-index")
def search_index():
    bs=many('SELECT id,code,name,"nameAr" FROM buildings ORDER BY code')
    for b in bs:b["floors"]=many('SELECT id,level,name FROM floors WHERE "buildingId"=%s ORDER BY level',(b["id"],))
    rs=many('SELECT r.id,r.code,r.name,r."nameAr",r.type::text AS type,f.level,r."floorId",b.code AS "buildingCode" FROM rooms r JOIN floors f ON f.id=r."floorId" JOIN buildings b ON b.id=f."buildingId" ORDER BY r.code')
    ps=many('SELECT p.id,p.type::text AS type,p.name,p."nameAr",p."floorId",p.level,b.code AS "buildingCode",p.x,p.y FROM pois p LEFT JOIN floors f ON f.id=p."floorId" LEFT JOIN buildings b ON b.id=f."buildingId" ORDER BY p.type,p.name')
    clubs=many('SELECT DISTINCT ON (r.organizer) r.organizer AS name,rm.code AS "roomCode",rm."floorId",r.title,r."startsAt",r."endsAt" FROM reservations r JOIN rooms rm ON rm.id=r."roomId" WHERE r.kind=\'CLUB\' AND r."endsAt">now() AND r."startsAt"<now()+interval \'7 days\' ORDER BY r.organizer,r."startsAt"')
    return {"generatedAt":datetime.now(timezone.utc).isoformat(),"buildings":bs,"rooms":rs,"pois":ps,"clubs":[{**c,"startsAt":jsonable(c["startsAt"]),"endsAt":jsonable(c["endsAt"])} for c in clubs]}


def route_graph():
    nodes = many('SELECT id,"floorId",level,kind,label,landmark,x,y FROM nav_nodes')
    edges = many('SELECT id,"fromId","toId",bidirectional,"lengthM", "hasStairs","stepCount","isRamp","slopePercent","widthCm","doorClearanceCm",surface,"isElevator","isOpen",verified,"wallSide","shorelineHint" FROM nav_edges')
    return {n["id"]:n for n in nodes}, edges


def resolve_route_location(value: dict, nodes: dict):
    kind=value.get("type")
    if kind=="node":
        n=nodes.get(value.get("id"))
    elif kind=="room":
        r=one('SELECT id,code,name,"doorNodeId" FROM rooms WHERE id=%s OR code=%s',(value.get("id"),value.get("id")))
        n=nodes.get(r["doorNodeId"]) if r and r["doorNodeId"] else None
        if n: kind="room"; value={**value,"name":f'{r["name"]} ({r["code"]})'}
    elif kind=="poi":
        p=one('SELECT id,name,"navNodeId" FROM pois WHERE id=%s',(value.get("id"),))
        n=nodes.get(p["navNodeId"]) if p and p["navNodeId"] else None
        if n: value={**value,"name":p["name"]}
    elif kind=="point":
        available=[n for n in nodes.values() if n["level"]==value.get("level") and (not value.get("floorId") or n["floorId"]==value.get("floorId"))]
        n=min(available,key=lambda item:(item["x"]-value["x"])**2+(item["y"]-value["y"])**2,default=None)
        if n and ((n["x"]-value["x"])**2+(n["y"]-value["y"])**2)**.5>40:n=None
    else:
        fail(422,"VALIDATION_ERROR","Location type must be room, poi, node or point")
    if not n:fail(404,"LOCATION_NOT_FOUND","Location is not connected to the navigation graph")
    return {"type":kind,"nodeId":n["id"],"name":value.get("name") or n["label"] or n["landmark"] or n["id"],"level":n["level"],"floorId":n["floorId"],"x":n["x"],"y":n["y"],"snappedDistanceM":None}


def dijkstra(nodes: dict, edges: list[dict], start: str, goal: str, constraints: dict, avoid_stairs: bool):
    adjacency: dict[str,list[tuple[str,dict]]]={}
    avoid=set(constraints.get("avoidEdgeIds",[]))
    for e in edges:
        if not e["isOpen"] or e["id"] in avoid:continue
        if (avoid_stairs and (e["hasStairs"] or e["stepCount"]>0)) or (constraints.get("verifiedOnly") and not e["verified"]):continue
        if constraints.get("verifiedRampsOnly") and e["isRamp"] and not e["verified"]:continue
        if constraints.get("maxSlopePercent") is not None and e["slopePercent"]>constraints["maxSlopePercent"]:continue
        if constraints.get("minDoorWidthCm") is not None and e["doorClearanceCm"] is not None and e["doorClearanceCm"]<constraints["minDoorWidthCm"]:continue
        adjacency.setdefault(e["fromId"],[]).append((e["toId"],e))
        if e["bidirectional"]:adjacency.setdefault(e["toId"],[]).append((e["fromId"],e))
    distances={start:0.0}; previous={}; queue=[(0.0,start)]
    while queue:
        distance,current=heapq.heappop(queue)
        if distance!=distances.get(current):continue
        if current==goal:break
        for nxt,e in adjacency.get(current,[]):
            cost=e["lengthM"]
            if e["isElevator"]:cost+=8
            if e["isRamp"]:cost+=max(e["lengthM"]*.05,e["slopePercent"]*.4)
            nd=distance+cost
            if nd<distances.get(nxt,float("inf")):
                distances[nxt]=nd;previous[nxt]=(current,e);heapq.heappush(queue,(nd,nxt))
    if goal not in distances:return None
    path_nodes=[goal];path_edges=[];cur=goal
    while cur!=start:
        cur,e=previous[cur];path_edges.append(e);path_nodes.append(cur)
    return list(reversed(path_nodes)),list(reversed(path_edges)),sum(e["lengthM"] for e in path_edges)


@app.post("/api/routes/plan")
async def route_plan(request: Request, authorization: str | None = Header(default=None)):
    body=await request.json()
    nodes,edges=route_graph()
    origin=resolve_route_location(body.get("from",{}),nodes); destination=resolve_route_location(body.get("to",{}),nodes)
    constraints=body.get("constraints",{})
    profile=None
    if authorization and authorization.lower().startswith("bearer ") and constraints.get("useProfile",True):
        claims=verify(authorization[7:].strip(),JWT_SECRET)
        if claims and claims.get("sub"):
            profile=one('SELECT * FROM accessibility_profiles WHERE "userId"=%s',(claims["sub"],))
    effective={"closedPassages":True,"avoidStairs":bool(constraints.get("avoidStairs", profile and profile["stepFree"])),
        "maxSlopePercent":constraints.get("maxSlopePercent",profile["maxSlopePercent"] if profile else None),
        "minDoorWidthCm":constraints.get("minDoorWidthCm",profile["minPassageWidthCm"] if profile else None),
        "verifiedRampsOnly":bool(constraints.get("verifiedRampsOnly",profile and profile["requireVerifiedRamps"])),
        "verifiedOnly":bool(constraints.get("verifiedOnly",False)),"avoidEdgeIds":constraints.get("avoidEdgeIds",[])}
    mode=body.get("mode") or ("wheelchair" if profile and profile["mobility"]=="WHEELCHAIR" else "walking")
    wanted=body.get("options") or ["fastest","step-free"]
    options=[];unavailable=[]
    for option in wanted:
        avoid_stairs=option=="step-free" or effective["avoidStairs"]
        path=dijkstra(nodes,edges,origin["nodeId"],destination["nodeId"],effective,avoid_stairs)
        if not path:
            unavailable.append({"option":option,"reason":"DISCONNECTED","message":"No route satisfies these constraints.","blockers":[]});continue
        path_nodes,path_edges,distance=path
        floors={nodes[n]["floorId"]:nodes[n] for n in path_nodes}
        eta=int(distance/(.75 if mode=="wheelchair" else 1.25))
        summaries=[]
        for index,e in enumerate(path_edges):
            src=nodes[path_nodes[index]];dst=nodes[path_nodes[index+1]]
            kind="ELEVATOR" if e["isElevator"] else "STAIRS" if e["hasStairs"] else "RAMP" if e["isRamp"] else "WALK"
            summaries.append({"index":index,"instruction":e.get("shorelineHint") or f"Continue to {dst.get('label') or dst.get('landmark') or 'the next point'}","distanceM":e["lengthM"],"edgeIds":[e["id"]],"kind":kind})
        geo=[]
        for fid,n in floors.items():
            feats=[]
            for i,e in enumerate(path_edges):
                a=nodes[path_nodes[i]];b=nodes[path_nodes[i+1]]
                if a["floorId"]==fid or b["floorId"]==fid:
                    feats.append({"type":"Feature","geometry":{"type":"LineString","coordinates":[[a["x"],a["y"]],[b["x"],b["y"]]]},"properties":{"edgeId":e["id"],"kind":"ELEVATOR" if e["isElevator"] else "RAMP" if e["isRamp"] else "WALK"}})
            geo.append({"floorId":fid,"level":n["level"],"buildingCode":None,"featureCollection":{"type":"FeatureCollection","features":feats}})
        options.append({"id":option,"label":"Step-free" if option=="step-free" else "Fastest","stepFree":not any(e["hasStairs"] or e["stepCount"] for e in path_edges),"distanceM":round(distance,1),"etaSec":eta,"travelMode":mode,"elevatorCount":sum(1 for e in path_edges if e["isElevator"]),"rampCount":sum(1 for e in path_edges if e["isRamp"]),"stairsCount":sum(1 for e in path_edges if e["hasStairs"]),"levels":list(dict.fromkeys(nodes[n]["level"] for n in path_nodes)),"constraints":effective,"prefilteredConstraints":[],"warnings":[],"nodeIds":path_nodes,"edgeIds":[e["id"] for e in path_edges],"steps":summaries,"geojson":geo})
    route_id=str(uuid.uuid4()) if options else None
    if route_id:
        if len(planned_routes)>10000:
            for key in list(planned_routes)[:1000]:planned_routes.pop(key,None)
        planned_routes[route_id]={"to":destination,"options":{o["id"]:o for o in options},"expires":time.monotonic()+10800}
    return {"routeId":route_id,"version":1,"engine":"dijkstra","from":origin,"to":destination,"travelMode":mode,"options":options,"unavailable":unavailable}


@app.post("/api/routes/{route_id}/recheck")
async def route_recheck(route_id: str, request: Request):
    body=await request.json(); position=body.get("position",{});stored=planned_routes.get(route_id)
    if not stored or stored["expires"]<=time.monotonic():
        planned_routes.pop(route_id,None);fail(404,"ROUTE_NOT_FOUND","This route expired or is no longer available; plan a new route")
    option=body.get("option") or next(iter(stored["options"]))
    route=stored["options"].get(option)
    if not route:fail(404,"ROUTE_OPTION_NOT_FOUND","That option is not part of this route")
    nodes,edges=route_graph();positions=[]
    for node_id in route["nodeIds"]:
        n=nodes.get(node_id)
        if n and n["level"]==position.get("level") and (not position.get("floorId") or n["floorId"]==position["floorId"]):
            positions.append((node_id,n))
    if positions:
        nearest_id,nearest=min(positions,key=lambda pair:(pair[1]["x"]-position["x"])**2+(pair[1]["y"]-position["y"])**2)
        distance=math.hypot(nearest["x"]-position["x"],nearest["y"]-position["y"])
        node_index=route["nodeIds"].index(nearest_id)
        completed=sum(e["lengthM"] for e in edges if e["id"] in route["edgeIds"][:node_index])
    else:
        nearest_id=None;distance=None;node_index=0;completed=0
    closed=next((e for e in edges if e["id"] in route["edgeIds"] and not e["isOpen"]),None)
    at_destination=bool(distance is not None and distance<=4 and position.get("level")==stored["to"]["level"] and nearest_id==stored["to"]["nodeId"])
    if closed:
        status_value="NO_ROUTE";reason="EDGE_CLOSED";message="A passage on this route is closed. Plan another route.";distance_value=distance
        blocked={"edgeId":closed["id"],"description":closed["id"],"closedReason":closed.get("closedReason")}
    elif at_destination:
        status_value="ARRIVED";reason=None;message="You have arrived.";distance_value=distance;blocked=None
    elif distance is None:
        status_value="NO_ROUTE";reason="WRONG_FLOOR";message="Your current floor is not on this route.";distance_value=None;blocked=None
    elif distance>8:
        status_value="NO_ROUTE";reason="OFF_ROUTE";message="You are off the planned route. Plan a new route from your current position.";distance_value=distance;blocked=None
    else:
        status_value="ON_ROUTE";reason=None;message="You are on route.";distance_value=distance;blocked=None
    progress={"completedM":round(completed,1),"remainingM":round(max(0,route["distanceM"]-completed),1),"nextStepIndex":min(node_index,len(route["steps"])-1) if route["steps"] else None} if distance is not None and status_value in ("ON_ROUTE","ARRIVED") else None
    return {"routeId":route_id,"version":1,"option":option,"status":status_value,"reason":reason,"message":message,"distanceFromRouteM":round(distance_value,1) if distance_value is not None else None,"progress":progress,"blockedEdge":blocked,"route":None,"unavailable":None}


@app.get("/api/mobility/consent")
def mobility_consent(user=Depends(current_user), lang: str = "fr"):
    row=one('SELECT * FROM mobility_consents WHERE "userId"=%s',(user["id"],))
    version=os.getenv("MOBILITY_POLICY_VERSION","2026-11-v1")
    granted = bool(row and row.get("revokedAt") is None)
    return {"granted":granted,"upToDate":granted and row["policyVersion"]==version,"policyVersion":row["policyVersion"] if row else None,"grantedAt":jsonable(row["grantedAt"]) if row else None,"revokedAt":jsonable(row["revokedAt"]) if row else None,"currentPolicy":{"version":version,"summary":["Location sharing is optional and can be stopped at any time.","Location data is retained for up to 30 days."],"retentionDays":30}}


@app.post("/api/mobility/consent")
async def mobility_grant(request: Request, user=Depends(current_user)):
    body=await request.json(); version=os.getenv("MOBILITY_POLICY_VERSION","2026-11-v1")
    if body.get("policyVersion")!=version: fail(409,"POLICY_OUTDATED","The consent policy has changed; review it before opting in")
    execute('INSERT INTO mobility_consents ("userId","policyVersion","grantedAt","revokedAt","updatedAt") VALUES (%s,%s,now(),NULL,now()) ON CONFLICT ("userId") DO UPDATE SET "policyVersion"=EXCLUDED."policyVersion","grantedAt"=now(),"revokedAt"=NULL,"updatedAt"=now()', (user["id"],version))
    return mobility_consent(user,body.get("lang","fr"))


@app.delete("/api/mobility/consent")
def mobility_revoke(user=Depends(current_user), deleteData: bool = False, lang: str = "fr"):
    day=daily_key();pseudo=pseudo_for(user["id"],day)
    ended=execute('UPDATE tracking_sessions SET "endedAt"=now(),"endReason"=\'CONSENT_WITHDRAWN\' WHERE "pseudoId"=%s AND "endedAt" IS NULL',(pseudo,))>0
    execute('UPDATE mobility_consents SET "revokedAt"=coalesce("revokedAt",now()),"updatedAt"=now() WHERE "userId"=%s',(user["id"],))
    deleted=delete_mobility_data(user) if deleteData else None
    return {"consent":mobility_consent(user,lang),"endedSession":ended,"deleted":deleted,"deletionOffer":None if deleteData else {"available":True,"endpoint":"DELETE /api/mobility/data","retainedDays":30}}


def daily_key(now: datetime | None = None):
    return (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("Africa/Algiers")).date().isoformat()


def pseudo_for(user_id: str, day_key: str):
    secret=os.getenv("PSEUDONYM_SECRET","")
    if len(secret)<32: fail(503,"MOBILITY_NOT_CONFIGURED","PSEUDONYM_SECRET must contain at least 32 characters")
    salt=one('SELECT salt FROM pseudonym_salts WHERE "dayKey"=%s',(day_key,))
    if not salt:
        execute('INSERT INTO pseudonym_salts ("dayKey",salt,"createdAt") VALUES (%s,%s,now()) ON CONFLICT ("dayKey") DO NOTHING',(day_key,secrets.token_hex(32)))
        salt=one('SELECT salt FROM pseudonym_salts WHERE "dayKey"=%s',(day_key,))
    digest=hmac.new(secret.encode(),f'{user_id}|{day_key}|{salt["salt"]}'.encode(),hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:32]


def delete_mobility_data(user):
    secret=os.getenv("PSEUDONYM_SECRET","")
    if len(secret)<32:fail(503,"MOBILITY_NOT_CONFIGURED","PSEUDONYM_SECRET must contain at least 32 characters")
    salts=many('SELECT "dayKey",salt FROM pseudonym_salts')
    pseudos=[base64.urlsafe_b64encode(hmac.new(secret.encode(),f'{user["id"]}|{s["dayKey"]}|{s["salt"]}'.encode(),hashlib.sha256).digest()).decode().rstrip("=")[:32] for s in salts]
    sessions=many('SELECT id FROM tracking_sessions WHERE "pseudoId"=ANY(%s)',(pseudos,)) if pseudos else []
    ids=[s["id"] for s in sessions]
    if not ids:return {"sessions":0,"points":0,"events":0}
    points=one('SELECT count(*) AS n FROM track_points WHERE "sessionId"=ANY(%s)',(ids,))["n"]
    events=one('SELECT count(*) AS n FROM difficulty_events WHERE "sessionId"=ANY(%s) OR "pseudoId"=ANY(%s)',(ids,pseudos))["n"]
    with db() as c:
        c.execute('DELETE FROM difficulty_events WHERE "sessionId"=ANY(%s) OR "pseudoId"=ANY(%s)',(ids,pseudos))
        c.execute('DELETE FROM tracking_sessions WHERE id=ANY(%s)',(ids,))
    return {"sessions":len(ids),"points":points,"events":events}


@app.delete("/api/mobility/data")
def mobility_delete(user=Depends(current_user)):
    return {"deleted":delete_mobility_data(user)}


@app.get("/api/mobility/sessions/current")
def mobility_current(user=Depends(current_user),lang:str="fr"):
    day=daily_key();pseudo=pseudo_for(user["id"],day)
    session=one('SELECT * FROM tracking_sessions WHERE "pseudoId"=%s AND "startedAt"<=now() ORDER BY "startedAt" DESC LIMIT 1',(pseudo,))
    return session_status(session,lang)


@app.post("/api/mobility/sessions", status_code=201)
async def mobility_start(request: Request,user=Depends(current_user)):
    body=await request.json()
    if not one('SELECT 1 FROM mobility_consents WHERE "userId"=%s AND "revokedAt" IS NULL AND "policyVersion"=%s',(user["id"],os.getenv("MOBILITY_POLICY_VERSION","2026-11-v1"))):
        fail(409,"CONSENT_REQUIRED","Explicit consent is required")
    if not one('SELECT id FROM campuses WHERE geofence IS NOT NULL LIMIT 1'):fail(422,"GEOFENCE_UNAVAILABLE","Location sharing cannot start until the campus geofence is verified")
    now=datetime.now(timezone.utc);day=daily_key(now);pseudo=pseudo_for(user["id"],day)
    execute('UPDATE tracking_sessions SET "endedAt"=%s,"endReason"=\'USER\' WHERE "pseudoId"=%s AND "endedAt" IS NULL',(now,pseudo))
    mobility=body.get("needsCategory") or (one('SELECT mobility::text AS mobility FROM accessibility_profiles WHERE "userId"=%s',(user["id"],)) or {}).get("mobility") or "NONE"
    if mobility not in ("NONE","WHEELCHAIR","REDUCED_MOBILITY","BLIND_LOW_VISION","DEAF_HARD_OF_HEARING","SPEECH"):fail(422,"VALIDATION_ERROR","Invalid mobility category")
    sid="c"+uuid.uuid4().hex[:24]
    execute('INSERT INTO tracking_sessions (id,"pseudoId","dayKey",mobility,"startedAt","pointCount") VALUES (%s,%s,%s,%s,%s,0)',(sid,pseudo,day,mobility,now))
    return session_status(one('SELECT * FROM tracking_sessions WHERE id=%s',(sid,)),body.get("lang","fr"))


@app.post("/api/mobility/sessions/{session_id}/stop")
def mobility_stop(session_id: str, user=Depends(current_user),lang:str="fr"):
    session=one('SELECT * FROM tracking_sessions WHERE id=%s',(session_id,))
    if not session or session["pseudoId"]!=pseudo_for(user["id"],session["dayKey"]):fail(404,"SESSION_NOT_FOUND","Tracking session not found")
    if session["endedAt"] is None:execute('UPDATE tracking_sessions SET "endedAt"=now(),"endReason"=\'USER\' WHERE id=%s',(session_id,))
    return session_status(one('SELECT * FROM tracking_sessions WHERE id=%s',(session_id,)),lang)


def session_status(session,lang="fr"):
    if not session:return {"state":"NONE","message":None,"session":None}
    start=session["startedAt"].replace(tzinfo=timezone.utc) if session["startedAt"].tzinfo is None else session["startedAt"]
    midnight=(datetime.fromisoformat(session["dayKey"]).replace(tzinfo=ZoneInfo("Africa/Algiers"))+timedelta(days=1)).astimezone(timezone.utc)
    cutoff=min(start+timedelta(hours=3),midnight);reason="TIME_LIMIT" if start+timedelta(hours=3)<=midnight else "DAILY_RESET"
    ended=session["endedAt"]
    active=ended is None and datetime.now(timezone.utc)<cutoff
    end_reason=session["endReason"]
    if ended is None and not active:
        ended=cutoff;execute('UPDATE tracking_sessions SET "endedAt"=%s,"endReason"=%s WHERE id=%s',(cutoff,reason,session["id"]))
        end_reason=reason
    remaining=max(0,int((cutoff-datetime.now(timezone.utc)).total_seconds())) if active else 0
    if active and remaining<=900:
        stop_time=cutoff.astimezone(ZoneInfo("Africa/Algiers")).strftime("%H:%M")
        reminder={"fr":f"Le partage s’arrêtera automatiquement à {stop_time}.","en":f"Location sharing will stop automatically at {stop_time}.","ar":f"ستتوقف مشاركة الموقع تلقائيًا عند {stop_time}."}.get(lang,"Le partage s’arrêtera automatiquement.")
    else:reminder=None
    return {"state":"ACTIVE" if active else "ENDED","message":reminder,"session":{"id":session["id"],"needsCategory":session["mobility"],"startedAt":jsonable(start),"endedAt":jsonable(ended),"endReason":end_reason if ended else None,"pointCount":session["pointCount"],"lastPointAt":jsonable(session["lastPointAt"]),"autoStopAt":jsonable(cutoff),"autoStopReason":reason,"remainingSec":remaining,"reminder":reminder}}


@app.post("/api/mobility/points")
async def mobility_points(request: Request,user=Depends(current_user)):
    body=await request.json();session=one('SELECT * FROM tracking_sessions WHERE id=%s',(body.get("sessionId"),))
    if not session or session["pseudoId"]!=pseudo_for(user["id"],session["dayKey"]):fail(404,"SESSION_NOT_FOUND","Tracking session not found")
    if not one('SELECT 1 FROM mobility_consents WHERE "userId"=%s AND "revokedAt" IS NULL AND "policyVersion"=%s',(user["id"],os.getenv("MOBILITY_POLICY_VERSION","2026-11-v1"))):fail(409,"CONSENT_REQUIRED","Current consent is required")
    if session["endedAt"]:fail(409,"SESSION_ENDED","This tracking session has ended",{"endReason":session["endReason"]})
    points=body.get("points",[])
    if not points or len(points)>100:fail(422,"VALIDATION_ERROR","Provide between 1 and 100 points")
    campus=one('SELECT id FROM campuses WHERE geofence IS NOT NULL LIMIT 1')
    if not campus:fail(422,"GEOFENCE_UNAVAILABLE","Campus geofence unavailable")
    dropped={"lowAccuracy":0,"outsideGeofence":0,"jitter":0,"outOfSession":0};accepted=0
    last=one('SELECT "recordedAt",x,y FROM track_points WHERE "sessionId"=%s ORDER BY "recordedAt" DESC LIMIT 1',(session["id"],))
    start=session["startedAt"].replace(tzinfo=timezone.utc) if session["startedAt"].tzinfo is None else session["startedAt"]
    cutoff=min(start+timedelta(hours=3),(datetime.fromisoformat(session["dayKey"]).replace(tzinfo=ZoneInfo("Africa/Algiers"))+timedelta(days=1)).astimezone(timezone.utc))
    for p in sorted(points,key=lambda v:v.get("recordedAt","")):
        t=datetime.fromisoformat(p["recordedAt"].replace("Z","+00:00")).astimezone(timezone.utc)
        prev=last["recordedAt"].replace(tzinfo=timezone.utc) if last and last["recordedAt"].tzinfo is None else last["recordedAt"] if last else None
        if (prev and t<=prev) or t>=cutoff or t>datetime.now(timezone.utc)+timedelta(minutes=2):dropped["outOfSession"]+=1;continue
        if p.get("accuracyM",1000)>10:dropped["lowAccuracy"]+=1;continue
        check=one('SELECT ST_Covers(geofence,ST_SetSRID(ST_MakePoint(%s,%s),0)) AS yes FROM campuses WHERE id=%s',(p["x"],p["y"],campus["id"]))
        if not check or not check["yes"]:
            dropped["outsideGeofence"]+=1
            execute('UPDATE tracking_sessions SET "endedAt"=%s,"endReason"=\'GEOFENCE_EXIT\' WHERE id=%s AND "endedAt" IS NULL',(t,session["id"]))
            break
        if last:
            seconds=max((t-prev).total_seconds(),1);distance=((p["x"]-last["x"])**2+(p["y"]-last["y"])**2)**.5
            if distance/seconds>3:dropped["jitter"]+=1;continue
        execute('INSERT INTO track_points ("sessionId","recordedAt",level,"floorId","accuracyM",x,y,"routeId") VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',(session["id"],t,p["level"],p.get("floorId"),p["accuracyM"],p["x"],p["y"],p.get("routeId")))
        accepted+=1;last={"recordedAt":t,"x":p["x"],"y":p["y"]}
    if accepted:execute('UPDATE tracking_sessions SET "pointCount"="pointCount"+%s,"lastPointAt"=%s WHERE id=%s',(accepted,last["recordedAt"],session["id"]))
    return {"accepted":accepted,"dropped":dropped,"session":session_status(one('SELECT * FROM tracking_sessions WHERE id=%s',(session["id"],)),body.get("lang","fr"))}


@app.post("/api/mobility/events", status_code=201)
async def mobility_event(request:Request,user=Depends(current_user)):
    body=await request.json();session=one('SELECT * FROM tracking_sessions WHERE id=%s',(body.get("sessionId"),))
    if not session or session["pseudoId"]!=pseudo_for(user["id"],session["dayKey"]):fail(404,"SESSION_NOT_FOUND","Tracking session not found")
    if not one('SELECT 1 FROM mobility_consents WHERE "userId"=%s AND "revokedAt" IS NULL AND "policyVersion"=%s',(user["id"],os.getenv("MOBILITY_POLICY_VERSION","2026-11-v1"))):fail(409,"CONSENT_REQUIRED","Current consent is required")
    if session["endedAt"]:fail(409,"SESSION_ENDED","This tracking session has ended")
    if body.get("type") not in ("BLOCKED","TOO_STEEP","HARD_TO_NAVIGATE"):fail(422,"VALIDATION_ERROR","Invalid report type")
    inside=one('SELECT ST_Covers(geofence,ST_SetSRID(ST_MakePoint(%s,%s),0)) AS yes FROM campuses WHERE geofence IS NOT NULL LIMIT 1',(body.get("x"),body.get("y")))
    if not inside or not inside["yes"]:fail(422,"OUTSIDE_GEOFENCE","Reports are only accepted inside the campus")
    edge=one('SELECT e.id FROM nav_edges e JOIN nav_nodes a ON a.id=e."fromId" JOIN nav_nodes b ON b.id=e."toId" WHERE (a.level=%s OR b.level=%s) AND ST_DWithin(e.geom,ST_SetSRID(ST_MakePoint(%s,%s),0),6) ORDER BY e.geom <-> ST_SetSRID(ST_MakePoint(%s,%s),0) LIMIT 1',(body["level"],body["level"],body["x"],body["y"],body["x"],body["y"]))
    eid="c"+uuid.uuid4().hex[:24];note=re.sub(r'[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s.-]{7,}\d','[…]',(body.get("note") or "").strip())[:280] or None
    recorded=datetime.now(timezone.utc)
    execute('INSERT INTO difficulty_events (id,"sessionId","pseudoId",type,mobility,level,"floorId","edgeId",note,"routeId","recordedAt",x,y) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(eid,session["id"],session["pseudoId"],body["type"],session["mobility"],body["level"],body.get("floorId"),edge["id"] if edge else None,note,body.get("routeId"),recorded,body["x"],body["y"]))
    return {"id":eid,"type":body["type"],"edgeId":edge["id"] if edge else None,"recordedAt":jsonable(recorded)}


@app.get("/api/admin/floors/svgs")
def floor_svgs():
    floors=many('SELECT f.id AS "floorId",f."buildingId",b.code AS "buildingCode",b.name AS "buildingName",f.level,f.name AS "floorName",count(r.id)::int AS "roomCount" FROM floors f JOIN buildings b ON b.id=f."buildingId" LEFT JOIN rooms r ON r."floorId"=f.id GROUP BY f.id,b.code,b.name ORDER BY b.code,f.level')
    for f in floors:
        path=SVG_DIR/(f["floorId"]+".svg");f["hasCustomSvg"]=path.is_file();f["updatedAt"]=datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat() if path.is_file() else None
    return {"items":floors}


SVG_DIR=Path(__file__).resolve().parent/"data"/"floor_svgs"
SVG_TAGS={"svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","defs","clipPath","mask","linearGradient","radialGradient","stop","title","desc"}
SVG_ATTRS={"id","viewBox","width","height","x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","d","points","transform","fill","fill-rule","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","opacity","font-size","font-family","font-weight","text-anchor","offset","stop-color","stop-opacity","clip-path","mask","xmlns"}


def sanitize_svg(source:str):
    if len(source)>2_000_000:fail(400,"SVG_TOO_LARGE","SVG documents must be at most 2 MB")
    try:root=ET.fromstring(source)
    except ET.ParseError:fail(400,"INVALID_SVG","Invalid SVG document")
    if root.tag.split("}")[-1]!="svg":fail(400,"INVALID_SVG","Root element must be svg")
    def clean(node):
        tag=node.tag.split("}")[-1]
        if tag not in SVG_TAGS:return None
        node.tag=tag
        for key in list(node.attrib):
            name=key.split("}")[-1].lower();value=node.attrib[key].strip()
            if name not in {a.lower() for a in SVG_ATTRS} or name.startswith("on") or "javascript:" in value.lower() or "url(http" in value.lower():node.attrib.pop(key,None)
        for child in list(node):
            if clean(child) is None:node.remove(child)
        return node
    clean(root)
    return ET.tostring(root,encoding="unicode",xml_declaration=True)


@app.get("/api/admin/floors/{floor_id}/svg")
def floor_svg(floor_id: str):
    floor=one('SELECT f.id,f.level,f.name,b.code AS "buildingCode",b.name AS "buildingName" FROM floors f JOIN buildings b ON b.id=f."buildingId" WHERE f.id=%s',(floor_id,))
    if not floor:fail(404,"NOT_FOUND","Floor not found")
    path=SVG_DIR/(floor_id+".svg")
    if path.is_file():
        content=sanitize_svg(path.read_text(encoding="utf-8"));custom=True;updated=datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()
    else:
        rooms=many('SELECT code,name FROM rooms WHERE "floorId"=%s ORDER BY code',(floor_id,));parts=[]
        for i,r in enumerate(rooms):
            x=30+(i%4)*190;y=50+(i//4)*130
            parts.append(f'<g><rect x="{x}" y="{y}" width="170" height="105" rx="6" fill="#f8fafc" stroke="#64748b"/><text x="{x+85}" y="{y+48}" text-anchor="middle" font-size="15">{html.escape(r["code"])}</text><text x="{x+85}" y="{y+75}" text-anchor="middle" font-size="12">{html.escape(r["name"])}</text></g>')
        content='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 500">'+''.join(parts)+'</svg>';custom=False;updated=datetime.now(timezone.utc).isoformat()
    return {"floorId":floor_id,"buildingCode":floor["buildingCode"],"buildingName":floor["buildingName"],"level":floor["level"],"floorName":floor["name"],"svgContent":content,"isCustom":custom,"updatedAt":updated}


@app.put("/api/admin/floors/{floor_id}/svg")
async def floor_svg_put(floor_id: str,request:Request,user=Depends(roles("ADMIN"))):
    floor=one('SELECT f.id,f.level,f.name,b.code AS "buildingCode",b.name AS "buildingName" FROM floors f JOIN buildings b ON b.id=f."buildingId" WHERE f.id=%s',(floor_id,))
    if not floor:fail(404,"NOT_FOUND","Floor not found")
    body=await request.json();content=sanitize_svg(body.get("svgContent",""))
    SVG_DIR.mkdir(parents=True,exist_ok=True);path=SVG_DIR/(floor_id+".svg");path.write_text(content,encoding="utf-8")
    return {"floorId":floor_id,"buildingCode":floor["buildingCode"],"buildingName":floor["buildingName"],"level":floor["level"],"floorName":floor["name"],"svgContent":content,"isCustom":True,"updatedAt":datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()}


@app.get("/api/admin/stats")
def admin_stats(user=Depends(roles("ADMIN"))):
    oldest=one('SELECT min("recordedAt") AS at,count(*) AS n FROM track_points')
    return {"generatedAt":datetime.now(timezone.utc).isoformat(),"kMin":5,"retentionDays":30,"sessions":{"active":None,"today":None,"last7d":None},"contributors":{"today":None,"last7d":None},"categories7d":[],"events7d":{"reported":{},"detected":{}},"rawData":{"points":oldest["n"],"oldestPointAt":jsonable(oldest["at"])},"queue":{"pendingCorrections":one("SELECT count(*) AS n FROM map_corrections WHERE status='PENDING'")["n"],"openRecommendations":one("SELECT count(*) AS n FROM recommendations WHERE status='OPEN'")["n"],"hotspots":one("SELECT count(*) AS n FROM hotspots")["n"]},"lastAggregationAt":None}


@app.get("/api/admin/heatmap")
def admin_heatmap(user=Depends(roles("ADMIN")), period: str = "TODAY", category: str = "ALL", level: int | None = None):
    params: list[Any]=[period,category,5]
    q='SELECT level,"cellX","cellY",x,y,"visitCount" AS visits,"contributorCount" AS contributors,"difficultyCount" AS difficulty,"stuckCount" AS stuck,"cellSizeM","windowStart","windowEnd","computedAt" FROM heatmap_cells WHERE period=%s AND segment=%s AND "contributorCount">=%s'
    if level is not None:q+=' AND level=%s';params.append(level)
    cells=many(q+' ORDER BY level,"cellY","cellX"',tuple(params))
    first=cells[0] if cells else {}
    return {"period":period,"category":category,"windowStart":jsonable(first.get("windowStart")),"windowEnd":jsonable(first.get("windowEnd")),"computedAt":jsonable(first.get("computedAt")),"cellSizeM":first.get("cellSizeM",2),"kMin":5,"cells":[{k:jsonable(v) for k,v in c.items() if k not in ("cellSizeM","windowStart","windowEnd","computedAt")} for c in cells]}


@app.get("/api/admin/corrections")
def admin_corrections(user=Depends(roles("ADMIN")), status: str | None = None, limit: int = 50):
    rows=many('SELECT c.*,u."displayName" AS "reviewerName",a.label AS "fromLabel",b.label AS "toLabel" FROM map_corrections c LEFT JOIN users u ON u.id=c."reviewedById" LEFT JOIN nav_edges e ON e.id=c."edgeId" LEFT JOIN nav_nodes a ON a.id=e."fromId" LEFT JOIN nav_nodes b ON b.id=e."toId"'+(' WHERE c.status=%s' if status else '')+' ORDER BY c.status,c."evidenceCount" DESC,c."createdAt" DESC LIMIT %s',((status,min(limit,200)) if status else (min(limit,200),)))
    return {"items":[correction_dto(c) for c in rows]}


def correction_dto(c):
    return {"id":c["id"],"kind":c["kind"],"source":c["source"],"status":c["status"],"title":c["title"],"description":c["description"],"edgeId":c["edgeId"],"edgeDescription":(c.get("fromLabel") or c.get("toLabel") or c["edgeId"]) if c["edgeId"] else None,"level":c["level"],"x":c["x"],"y":c["y"],"proposed":c["proposed"],"evidenceCount":c["evidenceCount"],"createdAt":jsonable(c["createdAt"]),"reviewedAt":jsonable(c["reviewedAt"]),"reviewedBy":c.get("reviewerName"),"reviewNote":c["reviewNote"]}


@app.get("/api/admin/recommendations")
def admin_recommendations(user=Depends(roles("ADMIN")), status: str | None = None, lang: str = "fr"):
    if status:rows=many('SELECT id,kind,status,title,rationale,score,evidence,level,x,y,"edgeId","updatedAt" FROM recommendations WHERE status=%s ORDER BY score DESC',(status,))
    else:rows=many('SELECT id,kind,status,title,rationale,score,evidence,level,x,y,"edgeId","updatedAt" FROM recommendations ORDER BY score DESC')
    for r in rows:r["updatedAt"]=jsonable(r["updatedAt"])
    return {"formula":"impact = disabled-student passes/week × stuck-or-blocked rate × detour (m); score = 100 × (1 − e^(−impact/1500))","items":rows}


@app.patch("/api/admin/recommendations/{recommendation_id}")
async def admin_update_recommendation(recommendation_id:str,request:Request,user=Depends(roles("ADMIN"))):
    body=await request.json();status=body.get("status")
    if status not in ("OPEN","PLANNED","DONE","DISMISSED"):fail(422,"VALIDATION_ERROR","Invalid recommendation status")
    row=one('UPDATE recommendations SET status=%s,"updatedAt"=now() WHERE id=%s RETURNING *',(status,recommendation_id))
    if not row:fail(404,"NOT_FOUND","Recommendation not found")
    row["updatedAt"]=jsonable(row["updatedAt"])
    return {k:row[k] for k in ("id","kind","status","title","rationale","score","evidence","level","x","y","edgeId","updatedAt")}


@app.get("/api/admin/hotspots")
def admin_hotspots(user=Depends(roles("ADMIN")),level:int|None=None):
    rows=many('SELECT h.id,h.level,h."floorId",h.x,h.y,h."radiusM",h."eventCount",h."contributorCount",h."byType",h."byCategory",h."dominantType",h."edgeId",h."wallId",h."wallKind",h."wallSide",h."wallDistanceM",h."computedAt",e."hasStairs",e."isRamp",e."slopePercent",e."widthCm",e."doorClearanceCm",e."isOpen",a.label AS "fromLabel",b.label AS "toLabel" FROM hotspots h LEFT JOIN nav_edges e ON e.id=h."edgeId" LEFT JOIN nav_nodes a ON a.id=e."fromId" LEFT JOIN nav_nodes b ON b.id=e."toId"'+(' WHERE h.level=%s' if level is not None else '')+' ORDER BY h."eventCount" DESC',((level,) if level is not None else ()))
    items=[]
    for h in rows:
        edge={"id":h["edgeId"],"description":h["fromLabel"] or h["toLabel"] or h["edgeId"],"hasStairs":h["hasStairs"],"isRamp":h["isRamp"],"slopePercent":h["slopePercent"],"widthCm":min(h["widthCm"],h["doorClearanceCm"] or h["widthCm"]),"isOpen":h["isOpen"]} if h["edgeId"] else None
        shoreline={"wallId":h["wallId"],"wallKind":h["wallKind"],"side":h["wallSide"],"distanceM":h["wallDistanceM"] or 0} if h["wallId"] and h["wallKind"] and h["wallSide"] else None
        items.append({k:jsonable(h[k]) for k in ("id","level","floorId","x","y","radiusM","eventCount","contributorCount","dominantType","byType","byCategory","computedAt")} | {"edge":edge,"shoreline":shoreline})
    return {"kMin":5,"items":items}


@app.post("/api/admin/corrections/{correction_id}/reject")
async def admin_reject_correction(correction_id:str,request:Request,user=Depends(roles("ADMIN"))):
    body=await request.json();row=one('UPDATE map_corrections SET status=\'REJECTED\',"reviewedAt"=now(),"reviewedById"=%s,"reviewNote"=%s WHERE id=%s AND status=\'PENDING\' RETURNING id,status,"reviewedAt"',(user["id"],body.get("note"),correction_id))
    if not row:
        exists=one('SELECT id FROM map_corrections WHERE id=%s',(correction_id,))
        if not exists:fail(404,"NOT_FOUND","Correction not found")
        fail(409,"ALREADY_REVIEWED","Correction was already reviewed")
    updated=one('SELECT c.*,u."displayName" AS "reviewerName",a.label AS "fromLabel",b.label AS "toLabel" FROM map_corrections c LEFT JOIN users u ON u.id=c."reviewedById" LEFT JOIN nav_edges e ON e.id=c."edgeId" LEFT JOIN nav_nodes a ON a.id=e."fromId" LEFT JOIN nav_nodes b ON b.id=e."toId" WHERE c.id=%s',(correction_id,))
    return {"correction":correction_dto(updated),"applied":None}


@app.post("/api/admin/corrections/{correction_id}/approve")
async def admin_approve_correction(correction_id:str,request:Request,user=Depends(roles("ADMIN"))):
    body=await request.json();correction=one('SELECT * FROM map_corrections WHERE id=%s',(correction_id,))
    if not correction:fail(404,"NOT_FOUND","Correction not found")
    if correction["status"]!="PENDING":fail(409,"ALREADY_REVIEWED","Correction was already reviewed")
    changes=body.get("apply") or correction.get("proposed") or {}
    allowed={"isOpen","closedReason","slopePercent","widthCm","surface","isRamp","verified","wallSide","shorelineHint"}
    if correction.get("edgeId") and changes:
        if not isinstance(changes,dict) or set(changes)-allowed:fail(422,"VALIDATION_ERROR","Correction contains unsupported edge changes")
        colmap={"isOpen":'"isOpen"',"closedReason":'"closedReason"',"slopePercent":'"slopePercent"',"widthCm":'"widthCm"',"surface":'"surface"',"isRamp":'"isRamp"',"verified":'"verified"',"wallSide":'"wallSide"',"shorelineHint":'"shorelineHint"'}
        execute('UPDATE nav_edges SET '+','.join(colmap[k]+'=%s' for k in changes)+',"updatedAt"=now() WHERE id=%s',(*changes.values(),correction["edgeId"]))
    one('UPDATE map_corrections SET status=\'ACCEPTED\',"reviewedAt"=now(),"reviewedById"=%s,"reviewNote"=%s WHERE id=%s RETURNING id',(user["id"],body.get("note"),correction_id))
    reviewed=one('SELECT c.*,u."displayName" AS "reviewerName",a.label AS "fromLabel",b.label AS "toLabel" FROM map_corrections c LEFT JOIN users u ON u.id=c."reviewedById" LEFT JOIN nav_edges e ON e.id=c."edgeId" LEFT JOIN nav_nodes a ON a.id=e."fromId" LEFT JOIN nav_nodes b ON b.id=e."toId" WHERE c.id=%s',(correction_id,))
    return {"correction":correction_dto(reviewed),"applied":changes or None}


@app.patch("/api/admin/edges/{edge_id}/status")
def edge_status(edge_id: str, request: Request, user=Depends(roles("ADMIN"))):
    import asyncio
    body=asyncio.run(request.json()); opened=body.get("isOpen")
    if not isinstance(opened,bool) or (not opened and len((body.get("closedReason") or "").strip())<3):fail(422,"VALIDATION_ERROR","closedReason is required when closing a passage")
    row=one('UPDATE nav_edges SET "isOpen"=%s,"closedReason"=%s,"updatedAt"=now() WHERE id=%s RETURNING id,"isOpen","closedReason","updatedAt"',(opened,None if opened else body.get("closedReason"),edge_id))
    if not row:fail(404,"NOT_FOUND",f"Edge {edge_id} not found")
    return {"edgeId":row["id"],"isOpen":row["isOpen"],"closedReason":row["closedReason"],"updatedAt":jsonable(row["updatedAt"])}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "4000")), reload=os.getenv("NODE_ENV") != "production")
