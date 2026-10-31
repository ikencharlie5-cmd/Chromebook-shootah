// Map layouts. Each character is one CELL x CELL (3m) square.
//   #  building / wall        .  floor
//   c  low cover (jumpable)   C  tall cover
//   o  pillar                 ~  water (canals)
//   1  ledge (1m, jump up)    2  raised platform / balcony (2.4m)
//   ^ v < >  stairs rising toward that direction (north, south, west, east)
//   ,  indoor floor (roofed)   w  wall with an open window   n  archway / doorway
//   A  site A    B  site B    T  attacker spawn    D  defender spawn
// Layouts are checked so neither spawn can see into the other.

export const MAP_DEFS = [
  {
    id: 'neon', name: 'Neon District', theme: 'neon',
    blurb: 'Rain-slick streets under a wall of neon signs.',
    rows: [
      '##########################',
      '#222222#..DDDDDD..#222222#',
      '#.AAAA^#..DDDDDD..#^BBBB.#',
      '#.AcAA.....DDDDDD....BBcB#',
      '#.AACA.#...######.#.BBBB.#',
      '#.AAAA.###.C..C.###.BBBB.#',
      '#......###......###......#',
      '###..######.##..#####..###',
      '#......c#..........#.....#',
      '#.......w.#w##w#.#.#..c..#',
      '#..C......n,,,,n.......C.#',
      '#.......w.##ww##.#.......#',
      '#...c...#........#...c...#',
      '###..######....######..###',
      '#........................#',
      '#..TTTTTTTTTTTTTTTTTTTT..#',
      '#..TTTTTTTTTTTTTTTTTTTT..#',
      '##########################',
    ],
  },
  {
    id: 'desert', name: 'Sunken Temple', theme: 'desert',
    blurb: 'Sandstone ruins and palm courtyards at sunset.',
    rows: [
      '##########################',
      '#.........###DDDDDD......#',
      '#.AAAAAA..###DDDDDD..o...#',
      '#.AAoAAA.......DDDD......#',
      '#.AAAAcA..#########.###..#',
      '#.AcAAAA..###.......###..#',
      '#..........##.......#2222#',
      '####..######..###...B^cBB#',
      '#.......o.....###...BBBBB#',
      '#..c..........###...BoBBB#',
      '#.....##n##.........BBBBB#',
      '#.....n,,,n..c..#####...##',
      '#..o..##w##.....#####....#',
      '#........................#',
      '####...TTTTTTTTTTTT...####',
      '####...TTTTTTTTTTTT...####',
      '##########################',
    ],
  },
  {
    id: 'snow', name: 'Frostbite Base', theme: 'snow',
    blurb: 'A frozen military outpost full of shipping containers.',
    rows: [
      '##########################',
      '#BBBBBB..#.DDDDDD.#......#',
      '#BBCBBB..#.DDDDDD.#.AAAA.#',
      '#BBBBcB.....DDDD.....AAcA#',
      '#BBBBBB..#.######.#.AAAA.#',
      '#........##.C..C.##.AACA.#',
      '##..C.#####......###.....#',
      '#.........#..22..#....####',
      '#..CC.....#.>22..#.......#',
      '#.........C......c..CC...#',
      '#....#,,,#...cc...#ww#...#',
      '#..c.#,,,w........####.c.#',
      '#............##..........#',
      '#.....TTTTTTTTTTTTTT.....#',
      '#.....TTTTTTTTTTTTTT.....#',
      '##########################',
    ],
  },
  {
    id: 'jungle', name: 'Overgrowth', theme: 'jungle',
    blurb: 'An abandoned research lab swallowed by the jungle.',
    rows: [
      '##########################',
      '#AAAAA.###DDDDDD###222222#',
      '#AAcAA.###DDDDDD###^BBBB.#',
      '#AAAAA......DDDD....BBBB.#',
      '#..C..##..######.##.BcBB.#',
      '#.....##.#w..w#.##..BBBB.#',
      '###.####.##..##.##.......#',
      '#.......#.......####..####',
      '#.c.,,,,w..c.......#.....#',
      '#...,,,,#.....#....#..c..#',
      '#...........###.........C#',
      '####..####..###..######..#',
      '#........................#',
      '#....TTTTTTTTTTTTTTTT....#',
      '#....TTTTTTTTTTTTTTTT....#',
      '##########################',
    ],
  },
  {
    id: 'canals', name: 'Canal Quarter', theme: 'canals',
    blurb: 'Bridges, gondolas and narrow lanes along the water.',
    rows: [
      '##########################',
      '#222222##.DDDDDD.##222222#',
      '#^AAAA.##.DDDDDD.##.BBBB^#',
      '#.AcAA......DDDD.....BcB.#',
      '#.AAAA.##.######.##.BBBB.#',
      '#.AACA.##.c....c.##.BBCB.#',
      '#......####vvvv####......#',
      '#~~..~~~~~~1111~~~~~~..~~#',
      '#~~..~~~~~~1111~~~~~~..~~#',
      '#......##..^^^^....##....#',
      '#..c...##..........##.c..#',
      '#......##..ww..##........#',
      '#...........c............#',
      '###..TTTTTTTTTTTTTTTT..###',
      '###..TTTTTTTTTTTTTTTT..###',
      '##########################',
    ],
  },
];

export function randomMapDef() {
  return MAP_DEFS[Math.floor(Math.random() * MAP_DEFS.length)];
}
