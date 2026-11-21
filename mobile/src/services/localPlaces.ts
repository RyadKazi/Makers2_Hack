import AsyncStorage from '@react-native-async-storage/async-storage';
export type SavedPlace = { id:string; routeId?:string; name:string; kind:'room'|'poi'; buildingCode?:string; level?:number; floorId?:string };
const RECENTS='accesu.recent-places';const FAVOURITES='accesu.favourite-places';
export async function recentPlaces():Promise<SavedPlace[]>{try{return JSON.parse((await AsyncStorage.getItem(RECENTS))||'[]');}catch{return [];}}
export async function favouritePlaces():Promise<SavedPlace[]>{try{return JSON.parse((await AsyncStorage.getItem(FAVOURITES))||'[]');}catch{return [];}}
export async function rememberPlace(place:SavedPlace){const current=await recentPlaces();await AsyncStorage.setItem(RECENTS,JSON.stringify([place,...current.filter(p=>p.id!==place.id)].slice(0,5)));}
export async function toggleFavourite(place:SavedPlace){const current=await favouritePlaces();const next=current.some(p=>p.id===place.id)?current.filter(p=>p.id!==place.id):[place,...current];await AsyncStorage.setItem(FAVOURITES,JSON.stringify(next));return next;}
