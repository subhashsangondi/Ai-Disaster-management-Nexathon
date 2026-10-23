export function getMapLinks(values) {
  const links = [];
  const hasValidCoordinates =
    Number.isFinite(values.latitude) &&
    values.latitude >= -90 &&
    values.latitude <= 90 &&
    Number.isFinite(values.longitude) &&
    values.longitude >= -180 &&
    values.longitude <= 180;

  if (hasValidCoordinates) {
    const coordinates = `${values.latitude},${values.longitude}`;
    links.push({
      label: "Check GPS coordinates on Google Maps",
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`,
    });
  }

  const manualLocation = values.location_text.trim();
  if (manualLocation) {
    links.push({
      label: "Check typed location on Google Maps",
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(manualLocation)}`,
    });
  }

  return links;
}
