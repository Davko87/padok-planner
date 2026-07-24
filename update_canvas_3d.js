const fs = require('fs');

let content = fs.readFileSync('/Users/davko/Projekty/Padok/src/components/PaddockCanvas.jsx', 'utf8');

content = content.replace(
  `import { Map } from '@vis.gl/react-google-maps';`,
  `import { Map3D } from '@vis.gl/react-google-maps';`
);

content = content.replace(
  `          <Map
            mapId={import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
            defaultCenter={{ lat: eventData.bounds.center[1], lng: eventData.bounds.center[0] }}
            defaultZoom={eventData.bounds.zoom || 17}
            defaultTilt={0}
            defaultHeading={0}
            disableDefaultUI={true}
            gestureHandling="none"
            mapTypeId="hybrid"
            renderingType="VECTOR"
            keyboardShortcuts={false}
          />`,
  `          <Map3D
            center={{ lat: eventData.bounds.center[1], lng: eventData.bounds.center[0], altitude: 0 }}
            range={Math.pow(2, 21 - (eventData.bounds.zoom || 17)) * 25}
            tilt={0}
            heading={0}
            defaultLabelsDisabled={false}
          />`
);

fs.writeFileSync('/Users/davko/Projekty/Padok/update_canvas_3d.js', content);
