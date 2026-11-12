"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";

const FONT = "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif";

function drawSign(title: string, subtitle: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  // wooden board
  ctx.fillStyle = "#7a4f30";
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 192, 36);
  ctx.fill();
  ctx.fillStyle = "#fff3dd";
  ctx.beginPath();
  ctx.roundRect(12, 12, 488, 168, 28);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = "#3b2a1e";
  ctx.font = `900 68px ${FONT}`;
  ctx.fillText(title, 256, 98, 470);
  ctx.fillStyle = "#8b5e3c";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(subtitle, 256, 148, 470);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A wooden sign with text, drawn locally into a texture (no font downloads). */
export function Sign({
  title,
  subtitle,
  position,
  rotationY,
  width = 2.6,
}: {
  title: string;
  subtitle: string;
  position: [number, number, number];
  rotationY: number;
  width?: number;
}) {
  const texture = useMemo(() => drawSign(title, subtitle), [title, subtitle]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[width, (width * 192) / 512]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
