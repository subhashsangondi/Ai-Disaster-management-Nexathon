import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmergencyLocationMap from "./EmergencyLocationMap.jsx";

const { mapHandlers, mapSetView } = vi.hoisted(() => ({
  mapHandlers: { current: null },
  mapSetView: vi.fn(),
}));

vi.mock("react-leaflet", () => ({
  CircleMarker: ({ center, children }) => (
    <div
      data-testid="incident-marker"
      data-center={JSON.stringify(center)}
    >
      {children}
    </div>
  ),

  MapContainer: ({
    center,
    zoom,
    children,
    scrollWheelZoom,
    doubleClickZoom,
    touchZoom,
    zoomControl,
  }) => (
    <div
      data-testid="map"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
      data-scroll-wheel-zoom={String(scrollWheelZoom)}
      data-double-click-zoom={String(doubleClickZoom)}
      data-touch-zoom={String(touchZoom)}
      data-zoom-control={String(zoomControl)}
    >
      {children}
    </div>
  ),

  Popup: ({ children }) => <div>{children}</div>,

  TileLayer: ({ url, attribution, maxZoom }) => (
    <div
      data-testid="satellite-layer"
      data-url={url}
      data-attribution={attribution}
      data-max-zoom={maxZoom}
    />
  ),

  useMap: () => ({
    setView: mapSetView,
  }),

  useMapEvents: (handlers) => {
    mapHandlers.current = handlers;
  },
}));

describe("EmergencyLocationMap", () => {
  beforeEach(() => {
    mapHandlers.current = null;
    mapSetView.mockClear();
  });

  it("uses the same satellite tiles as the dashboard", () => {
    render(
      <EmergencyLocationMap
        latitude={12.9716}
        longitude={77.5946}
        onSelectLocation={vi.fn()}
      />
    );

    expect(screen.getByTestId("satellite-layer")).toHaveAttribute(
      "data-url",
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    );
  });

  it("places the marker at the selected GPS coordinates", () => {
    render(
      <EmergencyLocationMap
        latitude={12.9716}
        longitude={77.5946}
        onSelectLocation={vi.fn()}
      />
    );

    expect(screen.getByTestId("incident-marker")).toHaveAttribute(
      "data-center",
      "[12.9716,77.5946]"
    );
    expect(screen.getByTestId("map")).toHaveAttribute("data-zoom", "13");

    expect(mapSetView).toHaveBeenCalledWith(
      [12.9716, 77.5946],
      13,
      { animate: true }
    );
  });

  it("starts with an unpinned India overview when no location is selected", () => {
    render(
      <EmergencyLocationMap
        latitude={null}
        longitude={null}
        onSelectLocation={vi.fn()}
      />
    );

    expect(screen.getByTestId("map")).toHaveAttribute(
      "data-center",
      "[20.5937,78.9629]"
    );

    expect(screen.getByTestId("map")).toHaveAttribute("data-zoom", "5");

    expect(screen.queryByTestId("incident-marker")).not.toBeInTheDocument();

    expect(mapSetView).not.toHaveBeenCalled();
  });

  it("enables the map zoom controls and interactions", () => {
    render(
      <EmergencyLocationMap
        latitude={null}
        longitude={null}
        onSelectLocation={vi.fn()}
      />
    );

    const map = screen.getByTestId("map");

    expect(map).toHaveAttribute("data-scroll-wheel-zoom", "true");
    expect(map).toHaveAttribute("data-double-click-zoom", "true");
    expect(map).toHaveAttribute("data-touch-zoom", "true");
    expect(map).toHaveAttribute("data-zoom-control", "true");
  });

  it("returns the exact coordinates selected by clicking the map", () => {
    const onSelectLocation = vi.fn();

    render(
      <EmergencyLocationMap
        latitude={null}
        longitude={null}
        onSelectLocation={onSelectLocation}
      />
    );

    mapHandlers.current.click({
      latlng: { lat: 13.045, lng: 77.62 },
    });

    expect(onSelectLocation).toHaveBeenCalledWith(13.045, 77.62);
  });
});