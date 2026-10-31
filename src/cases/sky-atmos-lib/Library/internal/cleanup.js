/** Attempt every independent release before reporting failures to the caller. */
export function runCleanup(actions, message = "Resource cleanup failed") {
    const errors = [];
    for (const action of actions) {
        try { action(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, message);
}
