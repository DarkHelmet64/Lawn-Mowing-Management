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
  where,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase.js";

function colRef(name) {
  return collection(db, name);
}

// `where`, if given, is a [field, op, value] triple applied as a Firestore
// range/equality filter server-side, so large collections (e.g. a growing
// weatherDaily) don't need to be pulled in full just to be filtered in JS.
export async function listAll(name, { orderByField, direction = "desc", where: whereClause } = {}) {
  const base = colRef(name);
  const constraints = [];
  if (whereClause) constraints.push(where(...whereClause));
  if (orderByField) constraints.push(orderBy(orderByField, direction));
  const q = constraints.length ? query(base, ...constraints) : base;
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

// Applies groups of update/delete operations ({ type, collection, id, data })
// in as few batch commits as possible. A group is never split across two
// commits, so each one (e.g. "merge these duplicates") lands all-or-nothing.
export async function batchWrite(groups) {
  const LIMIT = 450;
  let batch = writeBatch(db);
  let count = 0;
  for (const ops of groups) {
    if (count && count + ops.length > LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
    for (const op of ops) {
      const ref = doc(db, op.collection, op.id);
      if (op.type === "delete") batch.delete(ref);
      else batch.update(ref, op.data);
    }
    count += ops.length;
  }
  if (count) await batch.commit();
}
