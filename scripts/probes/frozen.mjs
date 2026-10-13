// Independent musical knowledge, frozen before any Qloo search or affinity request.
export const genres = {
  'Asleep at the Wheel': ['country', 'western swing'], 'New Constellations': ['indie', 'synthpop'],
  'Jesse Welles': ['folk', 'rock'], Turnstile: ['punk', 'rock'], Skrillex: ['electronic', 'dance'],
  Faouzia: ['pop'], 'Paris Paloma': ['folk', 'pop'], 'Brandon Flowers': ['rock', 'synthpop'],
  'Leon Thomas': ['rnb', 'soul'], 'Elle Coves': ['pop'], 'Izzy Escobar': ['pop'],
  'Grocery Bag': ['garage', 'rock'], 'Night Traveler': ['rock', 'synthpop'],
  'Marlon Funaki': ['indie', 'rock'], Rusowsky: ['electronic', 'pop'], 'Molly Santana': ['rap'],
  'The 4411': ['folk', 'indie'], 'Solomon Hicks': ['blues', 'rock'], 'Bo Staloch': ['folk', 'rock'],
  'Rebecca Black': ['electronic', 'pop'], 'Steve Aoki': ['electronic', 'dance'],
  'Elijah Delgado': ['folk', 'indie'], LP: ['rock', 'pop'], 'Bunt.': ['electronic', 'dance'],
  'The Chainsmokers': ['electronic', 'dance', 'pop'], 'Cowboy Can Can': ['country'],
  'Hunx and His Punx': ['punk', 'garage'], CMAT: ['country', 'pop'],
  'Amyl and the Sniffers': ['punk', 'rock'], Labrinth: ['rnb', 'pop'], 'Charli XCX': ['electronic', 'pop'],
};
export const triplets = [
  ['Skrillex', 'Steve Aoki', 'Brandon Flowers'], ['Steve Aoki', 'The Chainsmokers', 'Leon Thomas'],
  ['The Chainsmokers', 'Skrillex', 'Turnstile'], ['Bunt.', 'Steve Aoki', 'Solomon Hicks'],
  ['Turnstile', 'Amyl and the Sniffers', 'Labrinth'], ['Amyl and the Sniffers', 'Turnstile', 'The Chainsmokers'],
  ['Hunx and His Punx', 'Grocery Bag', 'Molly Santana'], ['Grocery Bag', 'Hunx and His Punx', 'Izzy Escobar'],
  ['Brandon Flowers', 'Night Traveler', 'Molly Santana'], ['Night Traveler', 'New Constellations', 'Solomon Hicks'],
  ['New Constellations', 'Night Traveler', 'Asleep at the Wheel'], ['Jesse Welles', 'Bo Staloch', 'Bunt.'],
  ['Bo Staloch', 'Jesse Welles', 'Rusowsky'], ['Paris Paloma', 'Jesse Welles', 'Steve Aoki'],
  ['Leon Thomas', 'Labrinth', 'Turnstile'], ['Labrinth', 'Leon Thomas', 'Amyl and the Sniffers'],
  ['Charli XCX', 'Rebecca Black', 'Asleep at the Wheel'], ['Rebecca Black', 'Charli XCX', 'Jesse Welles'],
  ['Faouzia', 'Elle Coves', 'Grocery Bag'], ['Elle Coves', 'Izzy Escobar', 'Solomon Hicks'],
];
export const protocol = {
  frozenAt: '2026-10-13', genreSource: 'Assistant prior musical knowledge; no Qloo data; approximate labels, not ground truth',
  genreSimilarity: 'Jaccard, followed by the same tied within-row percentile and reciprocal mean; strong >= 0.90',
  source: 'Skrillex', controlCity: 'Tokyo, Japan', k: 4, buffer: 0, solverSeed: 20261013, evaluations: 15000,
  bottomHalf: 'ceil(n/2) distinct acts with lowest within-stage billing fraction; ties by original start then name; repeated acts use highest fraction',
  bands: 'First set opener; last set headline on main stages (exact lock), sub-headline elsewhere; penultimate sub-headline; remaining middle. Band windows span original starts through original ends at the same tier and band.',
  changeover: 'Minimum observed adjacent gap per stage, inferred (not contractual); occupied Silent Disco kept fixed',
};
