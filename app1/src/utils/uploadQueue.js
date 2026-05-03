const QUEUE_KEY = "yogaUploadQueue";

export function addToQueue(item) {
  const queue = getQueue();
  const exists = queue.find((q) => q.sampleId === item.sampleId);
  if (!exists) {
    queue.push({
      ...item,
      status: "pending",
      retryCount: 0,
      addedAt: new Date().toISOString(),
    });
    saveQueue(queue);
  }
}

export function getQueue() {
  const raw = localStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function updateQueueItem(sampleId, updates) {
  const queue = getQueue();
  const index = queue.findIndex((q) => q.sampleId === sampleId);
  if (index !== -1) {
    queue[index] = { ...queue[index], ...updates };
    saveQueue(queue);
  }
}

export function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function checkDuplicate(sampleId) {
  return localStorage.getItem(`uploaded_${sampleId}`) !== null;
}
