export const RESOLVE_REVIEW_THREAD_MUTATION = /* GraphQL */ `
  mutation ResolveReviewThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`;
