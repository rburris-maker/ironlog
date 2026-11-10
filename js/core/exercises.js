// Built-in exercise library. Each exercise has a permanent ID — workouts refer to the ID,
// never the name, so history and records follow an exercise across every routine.

export const GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Other'];

const lib = {
  Chest: [
    ['bench-press', 'Bench Press'],
    ['incline-bench-press', 'Incline Bench Press'],
    ['decline-bench-press', 'Decline Bench Press'],
    ['dumbbell-bench-press', 'Dumbbell Bench Press'],
    ['incline-dumbbell-press', 'Incline Dumbbell Press'],
    ['machine-chest-press', 'Machine Chest Press'],
    ['chest-fly', 'Dumbbell Chest Fly'],
    ['cable-crossover', 'Cable Crossover'],
    ['pec-deck', 'Pec Deck'],
    ['push-up', 'Push-Up'],
    ['chest-dip', 'Chest Dip'],
  ],
  Back: [
    ['deadlift', 'Deadlift'],
    ['barbell-row', 'Barbell Row'],
    ['dumbbell-row', 'Dumbbell Row'],
    ['t-bar-row', 'T-Bar Row'],
    ['seated-cable-row', 'Seated Cable Row'],
    ['lat-pulldown', 'Lat Pulldown'],
    ['pull-up', 'Pull-Up'],
    ['chin-up', 'Chin-Up'],
    ['machine-row', 'Machine Row'],
    ['straight-arm-pulldown', 'Straight-Arm Pulldown'],
    ['back-extension', 'Back Extension'],
    ['shrug', 'Shrug'],
  ],
  Shoulders: [
    ['overhead-press', 'Overhead Press'],
    ['dumbbell-shoulder-press', 'Dumbbell Shoulder Press'],
    ['arnold-press', 'Arnold Press'],
    ['machine-shoulder-press', 'Machine Shoulder Press'],
    ['lateral-raise', 'Lateral Raise'],
    ['cable-lateral-raise', 'Cable Lateral Raise'],
    ['front-raise', 'Front Raise'],
    ['rear-delt-fly', 'Rear Delt Fly'],
    ['face-pull', 'Face Pull'],
    ['upright-row', 'Upright Row'],
  ],
  Arms: [
    ['barbell-curl', 'Barbell Curl'],
    ['dumbbell-curl', 'Dumbbell Curl'],
    ['hammer-curl', 'Hammer Curl'],
    ['preacher-curl', 'Preacher Curl'],
    ['cable-curl', 'Cable Curl'],
    ['tricep-pushdown', 'Tricep Pushdowns'],
    ['overhead-tricep-extension', 'Overhead Tricep Extension'],
    ['skull-crusher', 'Skull Crusher'],
    ['close-grip-bench-press', 'Close-Grip Bench Press'],
    ['tricep-dip', 'Tricep Dip'],
  ],
  Legs: [
    ['squat', 'Back Squat'],
    ['front-squat', 'Front Squat'],
    ['goblet-squat', 'Goblet Squat'],
    ['leg-press', 'Leg Press'],
    ['hack-squat', 'Hack Squat'],
    ['romanian-deadlift', 'Romanian Deadlift'],
    ['bulgarian-split-squat', 'Bulgarian Split Squat'],
    ['walking-lunge', 'Walking Lunge'],
    ['leg-extension', 'Leg Extension'],
    ['leg-curl', 'Leg Curl'],
    ['hip-thrust', 'Hip Thrust'],
    ['calf-raise', 'Standing Calf Raise'],
    ['seated-calf-raise', 'Seated Calf Raise'],
  ],
  Core: [
    ['plank', 'Plank'],
    ['hanging-leg-raise', 'Hanging Leg Raise'],
    ['cable-crunch', 'Cable Crunch'],
    ['ab-wheel', 'Ab Wheel Rollout'],
    ['russian-twist', 'Russian Twist'],
    ['sit-up', 'Sit-Up'],
  ],
  Other: [
    ['power-clean', 'Power Clean'],
    ['kettlebell-swing', 'Kettlebell Swing'],
    ['farmers-carry', "Farmer's Carry"],
    ['sled-push', 'Sled Push'],
  ],
};

// ---------- muscles ----------
// Twelve muscle groups. Every exercise names the muscles it works hardest ("primary")
// and the ones that assist ("secondary"); the Body screen uses this for recovery and ratings.

export const MUSCLES = [
  { id: 'chest', name: 'Chest' },
  { id: 'back', name: 'Back', detail: 'lats and upper back' },
  { id: 'lowerBack', name: 'Lower back' },
  { id: 'shoulders', name: 'Shoulders' },
  { id: 'biceps', name: 'Biceps' },
  { id: 'triceps', name: 'Triceps' },
  { id: 'forearms', name: 'Forearms' },
  { id: 'abs', name: 'Abs' },
  { id: 'glutes', name: 'Glutes' },
  { id: 'quads', name: 'Quads' },
  { id: 'hamstrings', name: 'Hamstrings' },
  { id: 'calves', name: 'Calves' },
];

export const MUSCLE_IDS = MUSCLES.map((m) => m.id);
export const muscleName = (id) => (MUSCLES.find((m) => m.id === id) || { name: id }).name;

// exercise id -> 'primary muscles | secondary muscles'
const WORKS = {
  'bench-press': 'chest | triceps shoulders',
  'incline-bench-press': 'chest | shoulders triceps',
  'decline-bench-press': 'chest | triceps',
  'dumbbell-bench-press': 'chest | triceps shoulders',
  'incline-dumbbell-press': 'chest | shoulders triceps',
  'machine-chest-press': 'chest | triceps shoulders',
  'chest-fly': 'chest | shoulders',
  'cable-crossover': 'chest | shoulders',
  'pec-deck': 'chest |',
  'push-up': 'chest | triceps shoulders abs',
  'chest-dip': 'chest | triceps shoulders',

  'deadlift': 'lowerBack glutes hamstrings | back quads forearms',
  'barbell-row': 'back | biceps lowerBack forearms',
  'dumbbell-row': 'back | biceps forearms',
  't-bar-row': 'back | biceps lowerBack',
  'seated-cable-row': 'back | biceps',
  'lat-pulldown': 'back | biceps',
  'pull-up': 'back | biceps forearms',
  'chin-up': 'back biceps | forearms',
  'machine-row': 'back | biceps',
  'straight-arm-pulldown': 'back | triceps',
  'back-extension': 'lowerBack | glutes hamstrings',
  'shrug': 'back | forearms',

  'overhead-press': 'shoulders | triceps abs',
  'dumbbell-shoulder-press': 'shoulders | triceps',
  'arnold-press': 'shoulders | triceps',
  'machine-shoulder-press': 'shoulders | triceps',
  'lateral-raise': 'shoulders |',
  'cable-lateral-raise': 'shoulders |',
  'front-raise': 'shoulders |',
  'rear-delt-fly': 'shoulders | back',
  'face-pull': 'shoulders | back',
  'upright-row': 'shoulders | back biceps',

  'barbell-curl': 'biceps | forearms',
  'dumbbell-curl': 'biceps | forearms',
  'hammer-curl': 'biceps forearms |',
  'preacher-curl': 'biceps | forearms',
  'cable-curl': 'biceps | forearms',
  'tricep-pushdown': 'triceps |',
  'overhead-tricep-extension': 'triceps |',
  'skull-crusher': 'triceps |',
  'close-grip-bench-press': 'triceps | chest shoulders',
  'tricep-dip': 'triceps | chest shoulders',

  'squat': 'quads glutes | hamstrings lowerBack abs',
  'front-squat': 'quads | glutes abs',
  'goblet-squat': 'quads | glutes abs',
  'leg-press': 'quads | glutes hamstrings',
  'hack-squat': 'quads | glutes',
  'romanian-deadlift': 'hamstrings glutes | lowerBack forearms',
  'bulgarian-split-squat': 'quads glutes | hamstrings',
  'walking-lunge': 'quads glutes | hamstrings',
  'leg-extension': 'quads |',
  'leg-curl': 'hamstrings |',
  'hip-thrust': 'glutes | hamstrings',
  'calf-raise': 'calves |',
  'seated-calf-raise': 'calves |',

  'plank': 'abs |',
  'hanging-leg-raise': 'abs | forearms',
  'cable-crunch': 'abs |',
  'ab-wheel': 'abs | shoulders',
  'russian-twist': 'abs |',
  'sit-up': 'abs |',

  'power-clean': 'glutes hamstrings back | quads shoulders lowerBack',
  'kettlebell-swing': 'glutes hamstrings | lowerBack shoulders',
  'farmers-carry': 'forearms | back abs',
  'sled-push': 'quads glutes | calves',
};

const parseWorks = (text) => {
  const [p, s] = String(text || '|').split('|');
  const words = (x) => (x || '').trim().split(/\s+/).filter(Boolean);
  return { primary: words(p), secondary: words(s) };
};

/** What a custom exercise is assumed to work until its muscles are chosen. */
export const GROUP_MUSCLES = {
  Chest: ['chest'],
  Back: ['back'],
  Shoulders: ['shoulders'],
  Arms: ['biceps', 'triceps'],
  Legs: ['quads', 'glutes', 'hamstrings'],
  Core: ['abs'],
  Other: [],
};

export const BUILT_IN = Object.entries(lib).flatMap(([group, items]) =>
  items.map(([id, name]) => ({ id, name, group, builtIn: true, muscles: parseWorks(WORKS[id]) })));

/** Muscles worked by any exercise record (built-in or custom). Always returns { primary, secondary }. */
export function musclesOf(exercise) {
  if (!exercise) return { primary: [], secondary: [] };
  const m = exercise.muscles;
  if (m && Array.isArray(m.primary)) {
    const ok = (list) => (Array.isArray(list) ? list.filter((x) => MUSCLE_IDS.includes(x)) : []);
    return { primary: ok(m.primary), secondary: ok(m.secondary) };
  }
  return { primary: [...(GROUP_MUSCLES[exercise.group] || [])], secondary: [] };
}

const t = (exerciseId, sets, reps) => ({ exerciseId, sets, reps });

/** Starter templates added to a brand-new account. They are ordinary templates and can be edited or deleted. */
export const STARTER_TEMPLATES = [
  { name: 'Push Day', items: [t('bench-press', 3, 8), t('incline-dumbbell-press', 3, 10), t('overhead-press', 3, 8), t('lateral-raise', 3, 12), t('tricep-pushdown', 3, 12)] },
  { name: 'Pull Day', items: [t('deadlift', 3, 5), t('lat-pulldown', 3, 10), t('barbell-row', 3, 8), t('face-pull', 3, 12), t('barbell-curl', 3, 10)] },
  { name: 'Leg Day', items: [t('squat', 3, 6), t('romanian-deadlift', 3, 8), t('leg-press', 3, 10), t('leg-curl', 3, 12), t('calf-raise', 3, 12)] },
  { name: 'Upper Body', items: [t('bench-press', 3, 8), t('barbell-row', 3, 8), t('dumbbell-shoulder-press', 3, 10), t('lat-pulldown', 3, 10), t('dumbbell-curl', 2, 12), t('tricep-pushdown', 2, 12)] },
  { name: 'Lower Body', items: [t('squat', 3, 6), t('hip-thrust', 3, 10), t('walking-lunge', 3, 10), t('leg-extension', 3, 12), t('seated-calf-raise', 3, 12)] },
  { name: 'Full Body', items: [t('squat', 3, 6), t('bench-press', 3, 8), t('barbell-row', 3, 8), t('overhead-press', 2, 10), t('hanging-leg-raise', 2, 10)] },
];
