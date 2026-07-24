const fs = require('fs');

let content = fs.readFileSync('/Users/davko/Projekty/Padok/src/components/PaddockCanvas.jsx', 'utf8');

content = content.replace(
  `import { Stage, Layer, Image as KonvaImage, Rect, Text, Group, Transformer } from 'react-konva';\nimport useImage from 'use-image';`,
  `import { Stage, Layer, Rect, Text, Group, Transformer } from 'react-konva';\nimport { Map } from '@vis.gl/react-google-maps';`
);

content = content.replace(
  /\/\/ Załaduj obraz satelitarny w tle z obsługą automatycznego ponawiania i fallbacks.*?\[bgStatus, useAnonymous, currentImageUrl, defaultFallbackUrl\]\);\n/s,
  `// Google Maps używane jako tło interaktywne\n`
);

content = content.replace(
  `const exportW = bgImage ? bgImage.width : stage.width();\n      const exportH = bgImage ? bgImage.height : stage.height();`,
  `const exportW = 1024;\n      const exportH = 1024;`
);

content = content.replace(
  /try \{\n\s*const proxyBgUrl.*?finalDataUrl = teamsOnlyDataUrl;\n\s*\}/s,
  `finalDataUrl = teamsOnlyDataUrl;`
);

content = content.replace(
  `const imgWidth = bgImage ? bgImage.width : 1024;\n  const imgHeight = bgImage ? bgImage.height : 1024;`,
  `const imgWidth = 1024;\n  const imgHeight = 1024;`
);

content = content.replace(
  `if (bgImage && containerRef.current) {`,
  `if (containerRef.current) {`
);

content = content.replace(
  `const scaleW = (containerW * 0.85) / bgImage.width;\n      const scaleH = (containerH * 0.85) / bgImage.height;`,
  `const scaleW = (containerW * 0.85) / 1024;\n      const scaleH = (containerH * 0.85) / 1024;`
);

content = content.replace(
  `x: (containerW - bgImage.width * initialScale) / 2,\n        y: (containerH - bgImage.height * initialScale) / 2,`,
  `x: (containerW - 1024 * initialScale) / 2,\n        y: (containerH - 1024 * initialScale) / 2,`
);

content = content.replace(
  `}, [bgImage]);`,
  `}, [eventData]);`
);

content = content.replace(
  /\{bgStatus === 'loading' && \(.*?\}\n/s,
  ``
);

const googleMapLayer = `
      {/* Google Maps Tło (Zoom i Pan mapy jest sterowane przez CSS transform dla synchronizacji z Konva) */}
      {eventData?.bounds && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1024,
            height: 1024,
            transformOrigin: '0 0',
            transform: \`translate(\${stagePos.x}px, \${stagePos.y}px) scale(\${stageScale})\`,
            zIndex: 0,
            pointerEvents: 'none' // blokujemy eventy dla mapy, obsługuje je Konva!
          }}
        >
          <Map
            mapId={import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
            defaultCenter={{ lat: eventData.bounds.center[1], lng: eventData.bounds.center[0] }}
            defaultZoom={eventData.bounds.zoom || 17}
            defaultTilt={0}
            defaultHeading={0}
            disableDefaultUI={true}
            gestureHandling="none"
            mapTypeId="satellite"
            keyboardShortcuts={false}
          />
        </div>
      )}
`;

content = content.replace(
  `{/* Warstwa 1: Obraz Satelitarny (Tło) */}\n        <Layer id="bg-layer">\n          {bgImage && (\n            <KonvaImage\n              name="background-image"\n              image={bgImage}\n              x={0}\n              y={0}\n              width={bgImage.width}\n              height={bgImage.height}\n              shadowColor="#000000"\n              shadowBlur={30}\n              shadowOpacity={0.7}\n            />\n          )}\n        </Layer>`,
  ``
);

content = content.replace(
  `{/* react-konva Stage */}`,
  googleMapLayer + `\n      {/* react-konva Stage (Ustawiona w absolutnym pozycjonowaniu nad Google Mapą) */}`
);

content = content.replace(
  `{bgImage && (\n            <Rect\n              x={0}\n              y={0}\n              width={bgImage.width}\n              height={bgImage.height}\n              stroke="rgba(255, 255, 255, 0.25)"\n              strokeWidth={2 / stageScale}\n              listening={false}\n            />\n          )}`,
  `<Rect\n              x={0}\n              y={0}\n              width={1024}\n              height={1024}\n              stroke="rgba(255, 255, 255, 0.25)"\n              strokeWidth={2 / stageScale}\n              listening={false}\n            />`
);

content = content.replace(
  `<Stage\n        ref={stageRef}`,
  `<Stage\n        style={{ position: 'absolute', inset: 0, zIndex: 10 }}\n        ref={stageRef}`
);

// We need to make sure we replaced the second occurrence of bgImage and containerRef.current (in handleResetCamera) correctly, so I'll just use global replace for that.
content = content.replace(/bgImage && containerRef\.current/g, `containerRef.current`);
content = content.replace(/bgImage\.width/g, `1024`);
content = content.replace(/bgImage\.height/g, `1024`);
content = content.replace(/exportW = bgImage \? 1024 : stage\.width\(\)/g, `exportW = 1024`);
content = content.replace(/exportH = bgImage \? 1024 : stage\.height\(\)/g, `exportH = 1024`);

fs.writeFileSync('/Users/davko/Projekty/Padok/src/components/PaddockCanvas.jsx', content);
console.log('Done!');
