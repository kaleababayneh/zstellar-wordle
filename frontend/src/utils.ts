/** Format seconds as MM:SS */
export function formatTime(secs: number): string {
  if (secs <= 0) return "00:00";
  const total = Math.ceil(secs);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}
