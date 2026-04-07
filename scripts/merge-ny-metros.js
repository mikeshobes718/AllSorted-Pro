/**
 * One-off merge: expands NY entries in metro-coords.json.
 * Run: node scripts/merge-ny-metros.js
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'metro-coords.json');

// Boroughs + major cities & large villages/towns (approximate downtown coords)
const NY_EXTRA = [
  ['Brooklyn', 40.6782, -73.9442],
  ['Queens', 40.7282, -73.7949],
  ['Bronx', 40.8448, -73.8648],
  ['Staten Island', 40.5795, -74.1502],
  ['Amsterdam', 42.9385, -74.1882],
  ['Auburn', 42.9317, -76.5661],
  ['Batavia', 42.9981, -78.1875],
  ['Beacon', 41.5081, -73.9685],
  ['Canandaigua', 42.8742, -77.2883],
  ['Cortland', 42.6012, -76.1805],
  ['Cohoes', 42.7742, -73.7001],
  ['Corning', 42.1429, -77.0547],
  ['Dunkirk', 42.4795, -79.3339],
  ['Elmira', 42.0898, -76.8077],
  ['Endicott', 42.0984, -76.0494],
  ['Fulton', 43.3228, -76.4172],
  ['Geneva', 42.868, -76.9854],
  ['Glen Cove', 40.8623, -73.6337],
  ['Glens Falls', 43.3171, -73.644],
  ['Gloversville', 43.0527, -74.3438],
  ['Hornell', 42.3278, -77.6611],
  ['Hudson', 42.2528, -73.791],
  ['Jamestown', 42.097, -79.2353],
  ['Johnstown', 43.0106, -74.3677],
  ['Kingston', 41.927, -73.9974],
  ['Lackawanna', 42.8256, -78.8237],
  ['Lockport', 43.1706, -78.6903],
  ['Middletown', 41.4459, -74.4229],
  ['Newburgh', 41.5034, -74.0104],
  ['North Tonawanda', 43.0387, -78.8642],
  ['Norwich', 42.5312, -75.5235],
  ['Ogdensburg', 44.6972, -75.4863],
  ['Oneida', 43.0626, -75.6519],
  ['Oneonta', 42.4529, -75.0638],
  ['Oswego', 43.4553, -76.5105],
  ['Peekskill', 41.2901, -73.9204],
  ['Plattsburgh', 44.6995, -73.4529],
  ['Poughkeepsie', 41.7004, -73.921],
  ['Rensselaer', 42.6295, -73.7429],
  ['Rome', 43.2128, -75.4557],
  ['Rye', 40.9807, -73.6837],
  ['Saratoga Springs', 43.0831, -73.7846],
  ['Watertown', 43.9748, -75.9108],
  ['Watervliet', 42.7301, -73.7012],
  ['Depew', 42.9039, -78.6923],
  ['Fairport', 43.0998, -77.4419],
  ['Harrison', 40.9689, -73.7126],
  ['Haverstraw', 41.1975, -73.9645],
  ['Huntington', 40.8682, -73.4261],
  ['Islip', 40.7299, -73.2104],
  ['Levittown', 40.7259, -73.5143],
  ['Massapequa', 40.6808, -73.4745],
  ['Monroe', 41.3307, -74.1849],
  ['New City', 41.1476, -73.9896],
  ['Olean', 42.097, -78.4299],
  ['Ossining', 41.1629, -73.8615],
  ['Port Chester', 41.0018, -73.6657],
  ['Smithtown', 40.8559, -73.2007],
  ['Tonawanda', 43.0203, -78.8803],
  ['Uniondale', 40.7004, -73.5929],
  ['Amherst', 42.9784, -78.7998],
  ['Cheektowaga', 42.9024, -78.7501],
  ['Greece', 43.2597, -77.6973],
  ['Irondequoit', 43.2134, -77.5797],
  ['Webster', 43.2123, -77.4299],
  ['Babylon', 40.6951, -73.3257],
  ['Brookhaven', 40.824, -72.9154],
  ['Oyster Bay', 40.8657, -73.5325],
  ['Hicksville', 40.7684, -73.5251],
  ['Flushing', 40.7678, -73.8337],
  ['Jamaica', 40.7022, -73.7949],
  ['Astoria', 40.7644, -73.9235],
  ['Elmhurst', 40.7367, -73.8779],
  ['Staten Island', 40.5795, -74.1502],
  ['Yonkers', 40.9312, -73.8988],
  ['Garden City', 40.7268, -73.6343],
  ['Rockville Centre', 40.6587, -73.6412],
  ['Oceanside', 40.6387, -73.6401],
  ['Franklin Square', 40.7004, -73.6759],
  ['Brentwood', 40.7812, -73.2462],
  ['Central Islip', 40.7901, -73.2018],
  ['Riverhead', 40.917, -72.662],
  ['Patchogue', 40.7657, -73.0151],
  ['Middletown', 41.4459, -74.4229],
  ['New Windsor', 41.4768, -74.0238],
  ['Wappingers Falls', 41.5994, -73.9189],
  ['Carmel', 41.4304, -73.6806],
  ['Mamaroneck', 40.9487, -73.7327],
  ['Pelham', 40.9098, -73.8103],
  ['Mount Kisco', 41.2043, -73.7268],
  ['Suffern', 41.1148, -74.1496],
  ['Pearl River', 41.059, -74.0218],
  ['Monsey', 41.1112, -74.0685],
  ['Watertown', 43.9748, -75.9108],
  ['Canton', 44.5955, -75.1691],
  ['Potsdam', 44.6698, -74.9813],
  ['Massena', 44.9281, -74.8918],
  ['Salamanca', 42.1578, -78.7152],
  ['Dansville', 42.5609, -77.6961],
  ['Geneseo', 42.7959, -77.8172],
  ['Batavia', 42.9981, -78.1875],
  ['Lockport', 43.1706, -78.6903],
  ['North Tonawanda', 43.0387, -78.8642],
  ['Kenmore', 42.9659, -78.8701],
  ['Lancaster', 42.9006, -78.6703],
  ['West Seneca', 42.8501, -78.7998],
  ['Cheektowaga', 42.9024, -78.7501],
  ['Tonawanda', 43.0203, -78.8803],
  ['Williamsville', 42.9639, -78.7378],
  ['Clarence', 42.9806, -78.5919],
  ['Orchard Park', 42.7678, -78.7439],
  ['Hamburg', 42.7159, -78.8295],
  ['Lackawanna', 42.8256, -78.8237],
  ['Niagara Falls', 43.0962, -79.0377],
  ['Watertown', 43.9748, -75.9108],
  ['Cortland', 42.6012, -76.1805],
  ['Cortland', 42.6012, -76.1805],
];

const raw = fs.readFileSync(file, 'utf8');
let data = JSON.parse(raw);

const byKey = (s) => s.city.toLowerCase().replace(/\s+/g, ' ').trim();
const rest = data.filter((r) => r.state !== 'NY');

const seen = new Set();
const nyRows = [];

function addNY(city, lat, lng) {
  const key = city.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  nyRows.push({ city, state: 'NY', lat, lng });
}

for (const row of data) {
  if (row.state === 'NY') addNY(row.city, row.lat, row.lng);
}
for (const [city, lat, lng] of NY_EXTRA) {
  addNY(city, lat, lng);
}

nyRows.sort((a, b) => a.city.localeCompare(b.city));

const out = [...nyRows, ...rest];
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log('NY cities:', nyRows.length, 'total rows:', out.length);
