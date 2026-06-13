/** Samba / Windows CMD argument sanitizer — strips shell metacharacters */
export function escShellArg(s) {
    return s.replace(/[&|^$%`;]/g, "").replace(/"/g, '""');
}
