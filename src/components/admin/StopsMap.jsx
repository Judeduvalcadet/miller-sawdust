import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/googleMaps';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Reusable Google map: numbered stop pins in driving order, optional home
// base pin and route line. With a single stop it just centers on the pin.
// `mapApiRef` (optional ref) receives { map } so callers can read the current
// view (for the snapshot feature).
export default function StopsMap({
  stops = [],            // [{ label, lat, lng }] in driving order
  home = null,           // { lat, lng } — start/end base
  showRoute = true,
  roadLegs = null,       // encoded Google polylines per leg — real road paths
  height = 200,
  mapTypeId = 'roadmap',
  mapApiRef = null,
}) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const infoRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((gm) => {
      if (cancelled || !divRef.current || mapRef.current) return;
      mapRef.current = new gm.Map(divRef.current, {
        center: home || (stops[0] ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: 40.554, lng: -81.918 }),
        zoom: 11,
        mapTypeId,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });
      if (mapApiRef) mapApiRef.current = { map: mapRef.current };
      draw(gm);
    }).catch(() => setFailed(true));
    return () => { cancelled = true; };
  }, []);

  const draw = (gm) => {
    const map = mapRef.current;
    if (!map) return;
    overlaysRef.current.forEach(o => o.setMap(null));
    overlaysRef.current = [];

    const bounds = new gm.LatLngBounds();
    const pin = (fill) => ({
      path: gm.SymbolPath.CIRCLE,
      scale: 13,
      fillColor: fill,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    });
    // Pickup stops (suppliers) draw as blue squares so the load source reads
    // apart from the numbered delivery circles and the amber home base.
    const squarePin = (fill) => ({
      path: 'M -1,-1 L 1,-1 L 1,1 L -1,1 Z',
      scale: 11,
      fillColor: fill,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    });

    if (home) {
      overlaysRef.current.push(new gm.Marker({
        map, position: home, icon: pin('#d97706'), zIndex: 1,
        label: { text: 'H', color: '#ffffff', fontSize: '12px', fontWeight: '700' },
        title: 'Home Hoop Building',
      }));
      bounds.extend(home);
    }
    // Hover card: customer name + loads
    infoRef.current?.close();
    if (!infoRef.current) {
      try {
        infoRef.current = new gm.InfoWindow({ disableAutoPan: true, headerDisabled: true });
      } catch {
        infoRef.current = new gm.InfoWindow({ disableAutoPan: true });
      }
    }
    const info = infoRef.current;

    let deliveryNum = 0;
    stops.forEach((s) => {
      const isPickup = s.kind === 'pickup';
      if (!isPickup) deliveryNum += 1;
      const marker = new gm.Marker({
        map,
        position: { lat: s.lat, lng: s.lng },
        icon: isPickup ? squarePin('#2563eb') : pin('#111827'),
        zIndex: isPickup ? 3 : 2,
        label: {
          text: isPickup ? 'P' : String(s.num ?? deliveryNum),
          color: '#ffffff', fontSize: '12px', fontWeight: '700',
        },
      });
      if (s.label) {
        marker.addListener('mouseover', () => {
          const sub = isPickup
            ? '<div style="font-weight:400;color:#6b7280;margin-top:1px">Load pickup</div>'
            : (s.loads != null
              ? `<div style="font-weight:400;color:#6b7280;margin-top:1px">${s.loads} load${s.loads === 1 ? '' : 's'}</div>`
              : '');
          info.setContent(`<div style="font:600 13px system-ui,sans-serif;color:#111827;padding:2px 4px">${escapeHtml(s.label)}${sub}</div>`);
          info.open({ map, anchor: marker });
        });
        marker.addListener('mouseout', () => info.close());
      }
      overlaysRef.current.push(marker);
      bounds.extend({ lat: s.lat, lng: s.lng });
    });

    if (showRoute && stops.length > 0 && home) {
      const arrowIcons = [{ icon: { path: gm.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.2, strokeColor: '#111827' }, offset: '50%', repeat: '120px' }];
      const encodedLegs = (roadLegs || []).filter(Boolean);
      if (encodedLegs.length > 0 && gm.geometry?.encoding) {
        // Real road geometry from the Routes API
        for (const enc of encodedLegs) {
          const path = gm.geometry.encoding.decodePath(enc);
          overlaysRef.current.push(new gm.Polyline({
            map, path,
            strokeColor: '#111827', strokeOpacity: 0.7, strokeWeight: 3.5,
            icons: arrowIcons,
          }));
        }
      } else {
        // Fallback while road paths load: light dashed straight lines
        const path = [home, ...stops.map(s => ({ lat: s.lat, lng: s.lng })), home];
        overlaysRef.current.push(new gm.Polyline({
          map, path,
          strokeOpacity: 0,
          icons: [
            { icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.35, strokeColor: '#111827', scale: 3 }, offset: '0', repeat: '14px' },
          ],
        }));
      }
    }

    if (stops.length + (home ? 1 : 0) > 1) {
      map.fitBounds(bounds, 36);
    } else if (stops.length === 1) {
      map.setCenter({ lat: stops[0].lat, lng: stops[0].lng });
      map.setZoom(16);
    }
  };

  // Redraw when the stops or road paths change (order applied, pin added, ...)
  useEffect(() => {
    if (mapRef.current && window.google?.maps) draw(window.google.maps);
  }, [JSON.stringify(stops), JSON.stringify(home), JSON.stringify(roadLegs)]);

  if (failed) {
    return (
      <div style={{ height }} className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400">
        Map unavailable
      </div>
    );
  }
  return <div ref={divRef} style={{ height }} className="rounded-lg border border-gray-200 overflow-hidden" />;
}
