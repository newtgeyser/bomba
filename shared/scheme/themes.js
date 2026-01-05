export const THEMES = Object.freeze([
  {
    id: 'green-acres',
    name: 'Green Acres',
    palette: {
      floor: '#0c1720',
      hard: '#2a3d55',
      soft: '#3f3a2d',
      explosion: 'rgba(255, 160, 40, 0.65)',
      item: '#4f8cff',
      bomb: '#0c0f16',
    },
  },
  {
    id: 'haunted',
    name: 'Haunted House',
    palette: {
      floor: '#0b0b12',
      hard: '#2f2b3d',
      soft: '#403038',
      explosion: 'rgba(210, 120, 255, 0.55)',
      item: '#69f0ff',
      bomb: '#111',
    },
  },
  {
    id: 'hockey',
    name: 'Hockey Rink',
    palette: {
      floor: '#0b1524',
      hard: '#375c85',
      soft: '#3a4b61',
      explosion: 'rgba(255, 200, 80, 0.65)',
      item: '#a7ff83',
      bomb: '#0b0e14',
    },
  },
]);

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

