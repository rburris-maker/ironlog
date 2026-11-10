// What the app currently knows about the user's groups. Kept in its own file so the
// workout screens can mark it out of date without importing the group screens.

export const groupCache = {
  userId: undefined,
  list: null,            // my groups, or null before the first answer
  listAt: 0,
  listError: null,
  listLoading: false,
  pages: new Map(),      // key -> { data, at, error, loading } for a group, a posted workout or a shared workout
};

/** Call after anything that changes what a group would show (finishing a workout, posting, joining…). */
export function groupsChanged() {
  groupCache.listAt = 0;
  for (const p of groupCache.pages.values()) p.at = 0;
}
