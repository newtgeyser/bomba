export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined) node.setAttribute(k, String(v));
  }
  for (const ch of children) node.append(ch);
  return node;
}

export function button(text, onClick, { primary } = {}) {
  return el(
    'button',
    { class: primary ? 'primary' : '', onclick: onClick, type: 'button', text },
    [],
  );
}

