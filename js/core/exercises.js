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

export const BUILT_IN = Object.entries(lib).flatMap(([group, items]) =>
  items.map(([id, name]) => ({ id, name, group, builtIn: true })));

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
