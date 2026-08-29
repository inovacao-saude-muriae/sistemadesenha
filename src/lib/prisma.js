export function formatQueueNumber(num) {
  if (!num || num <= 0) return '---';
  if (num >= 1000) return '999';
  return String(num).padStart(3, '0');
}