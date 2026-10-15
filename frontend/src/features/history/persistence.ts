import type { Workspace } from '../../types/workflow'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('conveditor', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('workspace')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadWorkspace(): Promise<Workspace | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readonly')
    const request = transaction.objectStore('workspace').get('current')
    transaction.oncomplete = () => { db.close(); resolve(request.result) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite')
    transaction.objectStore('workspace').put(workspace, 'current')
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
  })
}
