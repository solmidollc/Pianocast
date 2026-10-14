import { validProfile, type PianoProfile } from './profile';
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pianocanva.acoustic-profiles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profiles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadProfile(deviceId: string): Promise<PianoProfile | null> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('profiles').objectStore('profiles').get(deviceId);
    request.onsuccess = () => resolve(validProfile(request.result, deviceId) ? request.result : null);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function saveProfile(profile: PianoProfile) {
  if (!validProfile(profile, profile.deviceId)) throw new Error('Invalid piano profile');
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('profiles', 'readwrite'); tx.objectStore('profiles').put(profile, profile.deviceId);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
