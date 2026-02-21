/** Format seconds as MM:SS */
export function formatTime(secs: number): string {
  if (secs <= 0) return "00:00";
  const min = Math.floor(secs / 60);
  const sec = Math.ceil(secs % 60);
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}
