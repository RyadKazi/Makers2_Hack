"""Tests for the authenticated, versioned API contract."""

from datetime import datetime, timezone
from hashlib import sha256
from uuid import uuid4

from analytics.security import AnalyticsSettings
from data.postgres import PostgresDataAccess
from main import create_app
from models import Building, ConnectionType, Floor, NavigationEdge, NavigationNode, NodeType
from navigation.registry import BuildingRegistry
from tests.test_api import ApiTestClient


class FakeDataAccess(PostgresDataAccess):
    def __init__(self):
        super().__init__(dsn=None)

    def authenticate_api_key(self, raw_key):
        if raw_key == "accu_test.secret":
            return "test-key-id", {
                "navigation:route", "sessions:write", "analytics:write", "analytics:read",
                "recommendations:read", "recommendations:write",
            }
        return None

    def load_building(self, _building_id):
        return None


def sample_building():
    return Building(
        building_id="B1",
        floors=[Floor(floor_id="G", level=0)],
        nodes=[
            NavigationNode(node_id="A",building_id="B1",floor_id="G",x=0,y=0,node_type=NodeType.ENTRANCE),
            NavigationNode(node_id="B",building_id="B1",floor_id="G",x=5,y=0,node_type=NodeType.DOOR),
        ],
        edges=[NavigationEdge(source_node="A",destination_node="B",distance=5,connection_type=ConnectionType.DOORWAY)],
    )


def make_client():
    settings=AnalyticsSettings(
        service_token="legacy-service",admin_token="legacy-admin",contributor_hash_secret="hash-secret",
        minimum_sessions_per_group=2,minimum_contributors_per_group=2,
    )
    app=create_app(
        registry=BuildingRegistry([sample_building()]),
        analytics_settings=settings,
        data_access=FakeDataAccess(),
        allowed_origins=[],
    )
    return ApiTestClient(app)


def auth():
    return {"Authorization":"Bearer accu_test.secret"}


def test_api_keys_are_hash_checked_and_expired_or_revoked_keys_are_denied():
    class KeyRepository(PostgresDataAccess):
        def __init__(self,row):
            super().__init__(dsn=None)
            self.row=row
        def lookup_api_key(self,_prefix):
            return self.row

    row={"id":"key-1","key_prefix":"test","key_hash":sha256(b"secret").hexdigest(),
         "permissions":["navigation:route"],"expires_at":None,"revoked_at":None}
    repository=KeyRepository(row)
    assert repository.authenticate_api_key('accu_test.secret')==('key-1',{'navigation:route'})
    assert repository.authenticate_api_key('accu_test.wrong') is None
    row['revoked_at']=datetime.now(timezone.utc)
    assert repository.authenticate_api_key('accu_test.secret') is None
    row['revoked_at']=None
    from datetime import timedelta
    row['expires_at']=datetime.now(timezone.utc)-timedelta(seconds=1)
    assert repository.authenticate_api_key('accu_test.secret') is None


def test_v1_health_is_versioned_and_enveloped():
    client=make_client()
    with client:
        response=client.get('/api/v1/health')
    assert response.status_code==200
    assert response.json()['data']=={'status':'healthy','version':'v1'}


def test_v1_route_requires_private_key_and_returns_actual_path():
    client=make_client()
    body={"building_id":"B1","start_node":"A","destination_node":"B","profile":"wheelchair"}
    with client:
        unauthorized=client.post('/api/v1/navigation/route',json=body)
        response=client.post('/api/v1/navigation/route',json=body,headers=auth())
    assert unauthorized.status_code==401
    assert response.status_code==200
    assert response.json()['data']['route']==['A','B']
    assert response.json()['data']['total_distance']==5


def test_v1_analysis_returns_robust_aggregate_statistics():
    client=make_client()
    contributions=[]
    for profile,durations in [('general',[100,120]),('wheelchair',[340,360])]:
        for i,duration in enumerate(durations):
            contributions.append({
                "event_id":str(uuid4()),"session_id":str(uuid4()),
                "contributor_digest":f"{profile}-contributor-{i:02d}-digest-value",
                "building_id":"B1","origin_node":"A","destination_node":"B",
                "profile":profile,"context":"typical","completed":True,
                "duration_seconds":duration,"distance_m":5,"edge_keys":[["A","B"]],
                "staircase_ids":[],"obstacle_reports":[],"created_at":datetime.now(timezone.utc).isoformat(),
            })
    with client:
        response=client.post('/api/v1/analytics/analyze',json={"contributions":contributions},headers=auth())
        overview=client.get('/api/v1/analytics/overview',headers=auth())
    assert response.status_code==200
    disparity=response.json()['data']['disparities'][0]
    assert disparity['status']=='detected'
    assert disparity['general']['median_duration_seconds']==110
    assert disparity['accessibility']['median_duration_seconds']==350
    assert overview.json()['data']['disparities']==1


def test_v1_api_errors_keep_the_common_envelope():
    client=make_client()
    with client:
        response=client.post('/api/v1/navigation/route',json={},headers=auth())
    assert response.status_code==422
    assert response.json()['success'] is False
    assert response.json()['data'] is None
    assert response.json()['message']=='Request validation failed'


def test_v1_session_requires_explicit_consent_and_validates_event_path():
    client=make_client()
    start={
        "building_id":"B1","start_node":"A","destination_node":"B","profile":"wheelchair",
        "consent_given":True,"consent_version":"consent-v1","duration_choice":"this_navigation",
    }
    contributor={**auth(),"X-Accesu-Contributor-Ref":"a"*64}
    with client:
        disclosure=client.get('/api/v1/sessions/consent')
        bad=client.post('/api/v1/sessions/start',json={**start,"consent_given":False},headers=contributor)
        created=client.post('/api/v1/sessions/start',json=start,headers=contributor)
        session=created.json()['data']
        event=client.post(f"/api/v1/sessions/{session['session_id']}/events",json={
            "event_id":str(uuid4()),"origin_node":"A","destination_node":"B","profile":"wheelchair",
            "completed":True,"duration_seconds":35,"node_sequence":["A","B"],
        },headers={**auth(),"X-Accesu-Session-Token":session['session_token']})
        finished=client.post(f"/api/v1/sessions/{session['session_id']}/finish",headers={
            **auth(),"X-Accesu-Session-Token":session['session_token'],
        })
    assert disclosure.status_code==200
    assert disclosure.json()['data']['individual_journeys_visible_to_admins'] is False
    assert bad.status_code==422
    assert created.status_code==201
    assert event.status_code==201
    assert event.json()['data']['distance_m']==5
    assert finished.json()['data']['status']=='finished'
