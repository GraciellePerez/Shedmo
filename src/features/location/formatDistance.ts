export function formatDistanceMiles(distanceMiles: number | null | undefined) {
  if (distanceMiles == null || !Number.isFinite(distanceMiles) || distanceMiles < 0) return null;
  if (distanceMiles < 0.1) return '<0.1 mi away';
  return `${distanceMiles < 10 ? distanceMiles.toFixed(1) : Math.round(distanceMiles)} mi away`;
}

export function calculateDistanceMiles(
  origin: { latitude: number; longitude: number } | null | undefined,
  destination: { latitude?: number | null; longitude?: number | null },
) {
  if (!origin
    || !validLatitude(origin.latitude)
    || !validLongitude(origin.longitude)
    || !validLatitude(destination.latitude)
    || !validLongitude(destination.longitude)) return null;

  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude)
    * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

function validLatitude(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= -180 && value <= 180;
}
