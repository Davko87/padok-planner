import React from 'react';
import { Group, Rect, Path, Circle, Line } from 'react-konva';

// Funkcja pomocnicza przyciemniająca kolor by stworzyć krawędzie / akcenty
const shadeColor = (color, percent) => {
  if (!color) return '#000000';
  let R = parseInt(color.substring(1,3),16);
  let G = parseInt(color.substring(3,5),16);
  let B = parseInt(color.substring(5,7),16);

  R = parseInt(R * (100 + percent) / 100);
  G = parseInt(G * (100 + percent) / 100);
  B = parseInt(B * (100 + percent) / 100);

  R = (R<255)?R:255;  
  G = (G<255)?G:255;  
  B = (B<255)?B:255;  

  const RR = ((R.toString(16).length==1)?"0"+R.toString(16):R.toString(16));
  const GG = ((G.toString(16).length==1)?"0"+G.toString(16):G.toString(16));
  const BB = ((B.toString(16).length==1)?"0"+B.toString(16):B.toString(16));

  return "#"+RR+GG+BB;
};

// Konva pozwala na użycie wbudowanych cieni (shadowColor, shadowBlur) na grupach i kształtach.
// Kształty zostały zaprojektowane tak by miały width=100 i height proporcjonalne. Skalujemy je przez scaleX i scaleY.

export const TruckAsset = ({ color = '#ef4444', width, height }) => {
  const roofColor = color;
  const edgeColor = shadeColor(color, -20);
  const scaleX = width / 100;
  const scaleY = height / 400;

  return (
    <Group scaleX={scaleX} scaleY={scaleY}>
      {/* Kabina */}
      <Rect x={10} y={0} width={80} height={75} cornerRadius={[10, 10, 2, 2]} fill={edgeColor} />
      <Rect x={15} y={5} width={70} height={50} cornerRadius={5} fill="#334155" /> 
      <Rect x={20} y={15} width={60} height={30} cornerRadius={3} fill="#94a3b8" />
      
      {/* Naczepa (przestrzeń ładunkowa) */}
      <Rect x={0} y={78} width={100} height={232} cornerRadius={4} fill={roofColor} />
      <Rect x={5} y={83} width={90} height={222} cornerRadius={2} fill="rgba(255,255,255,0.1)" />
      
      {/* Rozłożona winda / rampa dla samochodów (na końcu naczepy) */}
      <Rect x={0} y={310} width={100} height={90} cornerRadius={[0, 0, 4, 4]} fill="#475569" />
      <Rect x={5} y={315} width={90} height={80} cornerRadius={2} fill="#64748b" />
      {/* Pasy najazdowe windy */}
      <Line points={[25, 315, 25, 395]} stroke="#94a3b8" strokeWidth={4} />
      <Line points={[75, 315, 75, 395]} stroke="#94a3b8" strokeWidth={4} />
    </Group>
  );
};

export const AwningAsset = ({ color = '#ef4444', width, height }) => {
  const roofColor = color;
  const edgeColor = shadeColor(color, -30);
  const scaleX = width / 200;
  const scaleY = height / 400;

  return (
    <Group scaleX={scaleX} scaleY={scaleY} opacity={0.85}>
      <Rect x={0} y={0} width={200} height={400} fill={roofColor} />
      <Line points={[0, 0, 200, 0]} stroke={edgeColor} strokeWidth={4} />
      <Line points={[0, 100, 200, 100]} stroke={edgeColor} strokeWidth={2} dash={[5,5]} />
      <Line points={[0, 200, 200, 200]} stroke={edgeColor} strokeWidth={2} dash={[5,5]} />
      <Line points={[0, 300, 200, 300]} stroke={edgeColor} strokeWidth={2} dash={[5,5]} />
      <Line points={[0, 400, 200, 400]} stroke={edgeColor} strokeWidth={4} />
      <Line points={[198, 0, 198, 400]} stroke={edgeColor} strokeWidth={4} />
    </Group>
  );
};

export const VanAsset = ({ color = '#ef4444', width, height }) => {
  const roofColor = color;
  const edgeColor = shadeColor(color, -20);
  const scaleX = width / 100;
  const scaleY = height / 240;

  return (
    <Group scaleX={scaleX} scaleY={scaleY}>
      <Rect x={0} y={0} width={100} height={240} cornerRadius={15} fill={roofColor} />
      <Path data="M 10 20 Q 50 0 90 20 L 90 50 L 10 50 Z" fill={edgeColor} />
      <Path data="M 15 40 Q 50 25 85 40 L 95 70 L 5 70 Z" fill="#334155" />
      <Rect x={20} y={225} width={60} height={10} cornerRadius={2} fill="#334155" />
      <Rect x={10} y={75} width={80} height={145} cornerRadius={5} fill="rgba(255,255,255,0.1)" />
      <Rect x={2} y={80} width={6} height={50} cornerRadius={2} fill="#334155" />
      <Rect x={92} y={80} width={6} height={50} cornerRadius={2} fill="#334155" />
    </Group>
  );
};

export const CarAsset = ({ color = '#ef4444', width, height }) => {
  const roofColor = color;
  const scaleX = width / 100;
  const scaleY = height / 200;

  return (
    <Group scaleX={scaleX} scaleY={scaleY}>
      <Rect x={0} y={0} width={100} height={200} cornerRadius={20} fill={roofColor} />
      <Path data="M 15 45 Q 50 30 85 45 L 90 75 Q 50 65 10 75 Z" fill="#1e293b" />
      <Path data="M 20 160 Q 50 170 80 160 L 85 140 Q 50 145 15 140 Z" fill="#1e293b" />
      <Rect x={15} y={80} width={70} height={55} cornerRadius={15} fill="rgba(255,255,255,0.2)" />
      <Rect x={-2} y={70} width={8} height={15} cornerRadius={3} fill="#475569" />
      <Rect x={94} y={70} width={8} height={15} cornerRadius={3} fill="#475569" />
    </Group>
  );
};

export const TentAsset = ({ color = '#ef4444', width, height }) => {
  const roofColor = color;
  const darkRoof = shadeColor(color, -15);
  const scaleX = width / 200;
  const scaleY = height / 200;

  return (
    <Group scaleX={scaleX} scaleY={scaleY}>
      <Rect x={0} y={0} width={200} height={200} fill={roofColor} />
      {/* Konva nie ma natywnego polygon z fill, użyjemy Path, lub linii i mniejszych Path, ale do prostych trójkątów możemy użyć Line z closed=true i fill */}
      <Line points={[0,0, 100,100, 200,0]} fill="rgba(255,255,255,0.1)" closed />
      <Line points={[200,0, 100,100, 200,200]} fill={darkRoof} closed />
      <Line points={[200,200, 100,100, 0,200]} fill="rgba(0,0,0,0.1)" closed />
      <Line points={[0,200, 100,100, 0,0]} fill={roofColor} closed />
      
      <Rect x={0} y={0} width={200} height={200} stroke="#ffffff" strokeWidth={4} />
      <Line points={[0,0, 200,200]} stroke="#ffffff" strokeWidth={2} />
      <Line points={[200,0, 0,200]} stroke="#ffffff" strokeWidth={2} />
      <Circle x={100} y={100} radius={10} fill="#ffffff" />
    </Group>
  );
};

export const TowTruckAsset = ({ color = '#ef4444', width, height }) => {
  const roofColor = color;
  const scaleX = width / 100;
  const scaleY = height / 400;

  return (
    <Group scaleX={scaleX} scaleY={scaleY}>
      <Rect x={15} y={0} width={70} height={60} cornerRadius={10} fill={roofColor} />
      <Rect x={20} y={10} width={60} height={40} cornerRadius={5} fill="#334155" />
      <Rect x={25} y={20} width={50} height={20} cornerRadius={3} fill="#94a3b8" />
      
      <Rect x={5} y={65} width={90} height={330} cornerRadius={5} fill="#475569" />
      <Rect x={15} y={70} width={70} height={320} cornerRadius={2} fill="#64748b" />
      
      <Rect x={20} y={380} width={15} height={20} fill="#334155" />
      <Rect x={65} y={380} width={15} height={20} fill="#334155" />
      
      <Rect x={1} y={200} width={5} height={40} cornerRadius={2} fill="#1e293b" />
      <Rect x={94} y={200} width={5} height={40} cornerRadius={2} fill="#1e293b" />
      <Rect x={1} y={260} width={5} height={40} cornerRadius={2} fill="#1e293b" />
      <Rect x={94} y={260} width={5} height={40} cornerRadius={2} fill="#1e293b" />
    </Group>
  );
};
