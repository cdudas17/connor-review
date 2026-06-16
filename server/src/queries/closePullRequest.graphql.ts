export const CLOSE_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation ClosePR($pullRequestId: ID!) {
    closePullRequest(input: { pullRequestId: $pullRequestId }) {
      pullRequest { id state }
    }
  }
`;
