export const ADD_PULL_REQUEST_REVIEW_MUTATION = /* GraphQL */ `
  mutation AddReview($pullRequestId: ID!, $event: PullRequestReviewEvent, $body: String, $threads: [DraftPullRequestReviewThread!]) {
    addPullRequestReview(input: {
      pullRequestId: $pullRequestId
      event: $event
      body: $body
      threads: $threads
    }) {
      pullRequestReview { id state }
    }
  }
`;
