import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  setDoc,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase.js";

function colRef(name) {
  return collection(db, name);
}

export async function listAll(name, { orderByField, direction = "desc" } = {}) {
  const base = colRef(name);
  const q = orderByField ? query(base, orderBy(orderByField, direction)) : base;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createDoc(name, data) {
  const ref = await addDoc(colRef(name), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

export async function updateDocById(name, id, data) {
  await updateDoc(doc(db, name, id), data);
}

export async function deleteDocById(name, id) {
  await deleteDoc(doc(db, name, id));
}

export async function getDocById(name, id) {
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setDocById(name, id, data) {
  await setDoc(doc(db, name, id), data, { merge: true });
}

export async function batchSet(name, items, idField) {
  const CHUNK = 400;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const item of items.slice(i, i + CHUNK)) {
      batch.set(doc(db, name, String(item[idField])), item, { merge: true });
    }
    await batch.commit();
  }
}
