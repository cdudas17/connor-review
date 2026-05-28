export const MARK_READY_FOR_REVIEW_MUTATION = /* GraphQL */ `
  mutation MarkReady($pullRequestId: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
      pullRequest { id isDraft }
    }
  }
`;
