import { Circle, Fill, Stroke, Style } from 'ol/style.js';

export function getStyle(color = '#3399CC') {
  const fill = new Fill({
    color: 'rgba(255,255,255,0.4)'
  });
  const stroke = new Stroke({
    color,
    width: 1.25
  });
  return new Style({
    image: new Circle({
      fill: fill,
      stroke: stroke,
      radius: 5
    }),
    fill: fill,
    stroke: stroke
  });
}
