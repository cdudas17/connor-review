export const ADD_PULL_REQUEST_REVIEW_MUTATION = /* GraphQL */ `
  mutation AddReview($pullRequestId: ID!, $event: PullRequestReviewEvent!, $body: String, $comments: [DraftPullRequestReviewComment!]) {
    addPullRequestReview(input: {
      pullRequestId: $pullRequestId
      event: $event
      body: $body
      comments: $comments
    }) {
      pullRequestReview { id state }
    }
  }
`;
