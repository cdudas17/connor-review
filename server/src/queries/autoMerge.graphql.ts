export const ENABLE_AUTO_MERGE_MUTATION = /* GraphQL */ `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod) {
    enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
      pullRequest {
        id
        autoMergeRequest {
          mergeMethod
          enabledAt
          enabledBy { login }
        }
      }
    }
  }
`;

export const DISABLE_AUTO_MERGE_MUTATION = /* GraphQL */ `
  mutation DisableAutoMerge($pullRequestId: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
      pullRequest { id autoMergeRequest { mergeMethod } }
    }
  }
`;
