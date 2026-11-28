import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Bike,
  Car,
  Clock,
  Footprints,
  MapPin,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Navigation,
  Route,
  TrainFront,
} from 'lucide-react';
import type { MapCardItem } from '../types/relay';

interface InteractiveMapCardProps {
  item: MapCardItem;
  onAskAboutMap?: (item: MapCardItem) => void;
}

/**
 * Lightweight WGS-84 -> GCJ-02 conversion for mainland China so if an Agent supplies
 * raw GPS WGS-84 coordinates they still align accurately on Amap (高德地图) tiles.
 */
function wgs84ToGcj02(lat: number, lng: number): [number, number] {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
    return [lat, lng];
  }
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const x = lng - 105.0;
  const y = lat - 35.0;
  let dLat =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  dLat += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  dLat += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  dLat +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;

  let dLng =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  dLng += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  dLng += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  dLng +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) /
    3.0;

  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}

function toAmapLatLng(lat: number, lng: number, coordSystem?: 'gcj02' | 'wgs84'): [number, number] {
  if (coordSystem === 'wgs84') {
    return wgs84ToGcj02(lat, lng);
  }
  return [lat, lng];
}

function buildAmapNavUrl(item: MapCardItem, destLat: number, destLng: number, orig?: [number, number]): string {
  const modeMap: Record<NonNullable<MapCardItem['travelMode']>, string> = {
    driving: 'car',
    transit: 'bus',
    walking: 'walk',
    cycling: 'ride',
  };
  const mode = modeMap[item.travelMode || 'transit'] || 'bus';
  if (orig && item.origin) {
    const fromStr = `${orig[1].toFixed(6)},${orig[0].toFixed(6)},${encodeURIComponent(item.origin.label || '起点')}`;
    const toStr = `${destLng.toFixed(6)},${destLat.toFixed(6)},${encodeURIComponent(item.title)}`;
    return `https://uri.amap.com/navigation?from=${fromStr}&to=${toStr}&mode=${mode}&coordinate=gaode&callnative=1`;
  }
  return `https://uri.amap.com/marker?position=${destLng.toFixed(6)},${destLat.toFixed(6)}&name=${encodeURIComponent(item.title)}&coordinate=gaode&callnative=1`;
}

function createPinIcon(kind: 'destination' | 'origin' | 'stop'): L.DivIcon {
  const color =
    kind === 'destination'
      ? '#38BDF8'
      : kind === 'origin'
        ? '#34D399'
        : '#A78BFA';
  const size = kind === 'destination' ? 18 : 13;
  const ring = kind === 'destination' ? `box-shadow: 0 0 0 6px rgba(56, 189, 248, 0.25), 0 0 14px rgba(56, 189, 248, 0.7);` : `box-shadow: 0 0 0 4px ${color}33;`;

  return L.divIcon({
    className: 'relay-amap-pin',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2.5px solid #ffffff;${ring}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export const InteractiveMapCard: React.FC<InteractiveMapCardProps> = ({
  item,
  onAskAboutMap,
}) => {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [expandedMap, setExpandedMap] = useState(false);

  const dest = useMemo(
    () => toAmapLatLng(item.lat, item.lng, item.coordSystem),
    [item.lat, item.lng, item.coordSystem]
  );

  const origin = useMemo(
    () =>
      item.origin
        ? toAmapLatLng(item.origin.lat, item.origin.lng, item.coordSystem)
        : undefined,
    [item.origin, item.coordSystem]
  );

  const waypoints = useMemo(
    () =>
      (item.waypoints || []).map((w) => ({
        ...w,
        pos: toAmapLatLng(w.lat, w.lng, item.coordSystem),
      })),
    [item.waypoints, item.coordSystem]
  );

  const amapUrl = useMemo(
    () => buildAmapNavUrl(item, dest[0], dest[1], origin),
    [item, dest, origin]
  );

  useEffect(() => {
    const el = mapElRef.current;
    if (!el) return;

    const map = L.map(el, {
      center: dest,
      zoom: item.zoom || 14,
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
    });
    mapInstanceRef.current = map;

    // Amap (高德地图) crisp Chinese street tiles (GCJ-02 native, no API key needed)
    L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=2&style=8&x={x}&y={y}&z={z}',
      {
        subdomains: ['1', '2', '3', '4'],
        maxZoom: 18,
        minZoom: 3,
      }
    ).addTo(map);

    const boundsPoints: L.LatLngExpression[] = [dest];

    // Route polyline: explicit polyline from Amap API if provided, else origin -> waypoints -> destination
    const routeCoords: L.LatLngExpression[] = [];
    if (item.polyline && item.polyline.length >= 2) {
      for (const pt of item.polyline) {
        const converted = toAmapLatLng(pt[0], pt[1], item.coordSystem);
        routeCoords.push(converted);
        boundsPoints.push(converted);
      }
    } else if (origin) {
      routeCoords.push(origin);
      boundsPoints.push(origin);
      for (const wp of waypoints) {
        routeCoords.push(wp.pos);
        boundsPoints.push(wp.pos);
      }
      routeCoords.push(dest);
    }

    if (routeCoords.length >= 2) {
      L.polyline(routeCoords, {
        color: '#38BDF8',
        weight: 4,
        opacity: 0.9,
        dashArray: item.polyline && item.polyline.length >= 2 ? undefined : '7 7',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
    }

    if (origin && item.origin) {
      L.marker(origin, { icon: createPinIcon('origin') })
        .addTo(map)
        .bindTooltip(item.origin.label, { direction: 'top', offset: [0, -8] });
    }

    for (const wp of waypoints) {
      boundsPoints.push(wp.pos);
      L.marker(wp.pos, { icon: createPinIcon('stop') })
        .addTo(map)
        .bindTooltip(wp.note ? `${wp.label} · ${wp.note}` : wp.label, {
          direction: 'top',
          offset: [0, -6],
        });
    }

    L.marker(dest, { icon: createPinIcon('destination') })
      .addTo(map)
      .bindTooltip(item.title, { direction: 'top', offset: [0, -10] });

    if (boundsPoints.length >= 2) {
      map.fitBounds(L.latLngBounds(boundsPoints), {
        padding: [28, 28],
        maxZoom: 16,
      });
    }

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 180);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [dest, origin, waypoints, item.polyline, item.zoom, item.title, item.origin, item.coordSystem]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      mapInstanceRef.current?.invalidateSize();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [expandedMap]);

  const ModeIcon =
    item.travelMode === 'driving'
      ? Car
      : item.travelMode === 'walking'
        ? Footprints
        : item.travelMode === 'cycling'
          ? Bike
          : TrainFront;

  const modeLabel =
    item.travelMode === 'driving'
      ? '驾车'
      : item.travelMode === 'walking'
        ? '步行'
        : item.travelMode === 'cycling'
          ? '骑行'
          : '公交地铁';

  return (
    <div
      style={
        {
          '--tile-tint': 'var(--tint-cyan)',
          '--tile-angle': '170deg',
        } as React.CSSProperties
      }
      className="board-tile !p-0"
    >
      {/* Interactive Amap Viewport */}
      <div className="relative overflow-hidden rounded-t-[inherit] border-b border-white/10">
        <div
          ref={mapElRef}
          className={`relay-amap-container w-full transition-[height] duration-200 ${
            expandedMap ? 'h-[310px]' : 'h-[196px]'
          }`}
        />

        {/* Floating Top Overlay: Source badge & Expand button */}
        <div className="pointer-events-none absolute top-2.5 left-2.5 right-2.5 z-[400] flex items-center justify-between gap-2">
          <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-black/65 px-2.5 py-1 text-[11px] font-medium text-sky-300 backdrop-blur-md">
            <MapPin className="h-3 w-3 shrink-0" />
            <span>高德地图 · {modeLabel}</span>
          </div>

          <button
            type="button"
            onClick={() => setExpandedMap((v) => !v)}
            aria-label={expandedMap ? '收起地图' : '放大地图'}
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-xl border border-white/15 bg-black/65 text-zinc-200 backdrop-blur-md transition-colors hover:bg-black/85"
          >
            {expandedMap ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Bottom Floating Route Metrics Strip */}
        {(item.distanceText || item.durationText) && (
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[400] flex items-center gap-1.5">
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/70 px-2.5 py-1 font-mono-tabular text-[11px] font-medium text-white backdrop-blur-md">
              <ModeIcon className="h-3.5 w-3.5 text-sky-300" />
              {item.durationText && <span>{item.durationText}</span>}
              {item.durationText && item.distanceText && (
                <span className="text-white/35">·</span>
              )}
              {item.distanceText && (
                <span className="text-zinc-300">{item.distanceText}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Visual-First Details & Actions */}
      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[15px] font-semibold leading-snug text-[var(--relay-text)]">
              {item.title}
            </h4>
            {item.openHours && (
              <span className="inline-flex shrink-0 items-center gap-1 font-mono-tabular text-[11px] text-[var(--relay-text-muted)]">
                <Clock className="h-3 w-3 text-[var(--accent-sky)]" />
                {item.openHours}
              </span>
            )}
          </div>
          {item.address && (
            <p className="mt-1 text-xs text-[var(--relay-text-muted)]">{item.address}</p>
          )}
        </div>

        {item.routeSummary && (
          <div className="flex items-center gap-2 rounded-xl border border-black/[0.07] bg-zinc-50 px-3 py-2 text-xs text-[var(--relay-text)] dark:border-white/10 dark:bg-zinc-900">
            <Route className="h-3.5 w-3.5 shrink-0 text-[var(--accent-sky)]" />
            <span className="leading-snug">{item.routeSummary}</span>
          </div>
        )}

        <p className="text-xs leading-relaxed text-[var(--relay-text-muted)]">
          {item.overview}
        </p>

        {item.highlights && item.highlights.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {item.highlights.map((tag, idx) => (
              <span
                key={idx}
                className="rounded-lg border border-black/[0.07] bg-zinc-50 px-2 py-0.5 text-[11px] text-[var(--relay-text-muted)] dark:border-white/10 dark:bg-white/6"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--relay-tile-border)] pt-3">
          <a
            href={amapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 whitespace-nowrap shrink-0"
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>高德导航</span>
          </a>

          {onAskAboutMap && (
            <button
              type="button"
              onClick={() => onAskAboutMap(item)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.09] bg-zinc-50 px-3.5 py-2 text-xs font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-100 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-white/8 dark:hover:bg-white/14"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span>换路线 / 查周边</span>
            </button>
          )}

          <span className="ml-auto font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
            {dest[0].toFixed(4)}, {dest[1].toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
};
