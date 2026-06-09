export type VcsKind = "git" | "svn" | "none";

export interface VcsCommitSummary {
  id: string;
  author?: string;
  date?: string;
  message: string;
}

export interface VcsFileInfo {
  kind: VcsKind;
  path: string;
  root?: string;
  branch?: string;
  url?: string;
  revision?: string;
  status?: string;
  lastCommit?: VcsCommitSummary;
}
