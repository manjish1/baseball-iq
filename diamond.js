/* Renders the baseball diamond diagram: bases, runners, outs, and the hit marker. */

const FIELD_POS = {
  P:  [200, 255], C:  [200, 358],
  '1B':[272, 222], '2B':[228, 168], SS:[150, 168], '3B':[128, 222],
  LF: [78, 96], CF: [200, 55], RF: [322, 96],
  H: [200, 330]
};

const BASE_COORDS = {
  home: [200, 340],
  first: [292, 248],
  second: [200, 156],
  third: [108, 248]
};

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function renderDiamond(container, { runners, outs, hit }) {
  container.innerHTML = '';
  const svg = svgEl('svg', { viewBox: '0 0 400 400', class: 'diamond-svg' });

  // Outfield grass arc
  svg.appendChild(svgEl('path', {
    d: 'M 20 340 Q 200 -40 380 340 L 340 340 Q 200 40 60 340 Z',
    class: 'grass-outfield'
  }));

  // Infield dirt diamond
  svg.appendChild(svgEl('polygon', {
    points: '200,340 292,248 200,156 108,248',
    class: 'infield-dirt'
  }));
  // Infield grass diamond (inner)
  svg.appendChild(svgEl('polygon', {
    points: '200,300 252,248 200,196 148,248',
    class: 'infield-grass'
  }));

  // Base paths
  svg.appendChild(svgEl('polyline', {
    points: '200,340 292,248 200,156 108,248 200,340',
    class: 'basepath'
  }));

  // Bases (squares), rotated 45deg to look like diamonds
  const baseOrder = [
    ['first', runners.first], ['second', runners.second], ['third', runners.third]
  ];
  for (const [key, occupied] of baseOrder) {
    const [x, y] = BASE_COORDS[key];
    svg.appendChild(svgEl('rect', {
      x: x - 10, y: y - 10, width: 20, height: 20,
      transform: `rotate(45 ${x} ${y})`,
      class: occupied ? 'base base-occupied' : 'base'
    }));
    if (occupied) {
      const runner = svgEl('circle', { cx: x, cy: y - 26, r: 9, class: 'runner-dot' });
      svg.appendChild(runner);
    }
  }
  // Home plate (pentagon)
  const [hx, hy] = BASE_COORDS.home;
  svg.appendChild(svgEl('polygon', {
    points: `${hx-11},${hy-8} ${hx+11},${hy-8} ${hx+11},${hy+2} ${hx},${hy+11} ${hx-11},${hy+2}`,
    class: 'home-plate'
  }));

  // Pitcher's mound
  svg.appendChild(svgEl('circle', { cx: 200, cy: 255, r: 14, class: 'mound' }));

  // Hit marker
  if (hit && hit.pos && FIELD_POS[hit.pos]) {
    const [fx, fy] = FIELD_POS[hit.pos];
    const icon = hit.type === 'fly' ? '⬆' : hit.type === 'line' ? '➜' : hit.type === 'bunt' ? '⛳' : '●';
    const marker = svgEl('g', { class: 'hit-marker' });
    marker.appendChild(svgEl('circle', { cx: fx, cy: fy, r: 16, class: `hit-circle hit-${hit.type || 'ground'}` }));
    const text = svgEl('text', { x: fx, y: fy + 5, class: 'hit-icon', 'text-anchor': 'middle' });
    text.textContent = icon;
    marker.appendChild(text);
    svg.appendChild(marker);

    if (hit.label) {
      const labelY = fy < 130 ? fy - 24 : fy + 34;
      const label = svgEl('text', { x: fx, y: labelY, class: 'hit-label', 'text-anchor': 'middle' });
      label.textContent = hit.label;
      svg.appendChild(label);
    }
  }

  container.appendChild(svg);

  // Outs lights (rendered outside the SVG, as HTML, appended after)
  const outsWrap = document.createElement('div');
  outsWrap.className = 'outs-indicator';
  const lbl = document.createElement('span');
  lbl.className = 'outs-label';
  lbl.textContent = 'OUTS';
  outsWrap.appendChild(lbl);
  for (let i = 0; i < 2; i++) {
    const dot = document.createElement('span');
    dot.className = 'out-dot' + (i < outs ? ' out-lit' : '');
    outsWrap.appendChild(dot);
  }
  container.appendChild(outsWrap);
}
