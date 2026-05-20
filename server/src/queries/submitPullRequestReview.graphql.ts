export const SUBMIT_PULL_REQUEST_REVIEW_MUTATION = /* GraphQL */ `
  mutation SubmitReview($pullRequestReviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
    submitPullRequestReview(input: {
      pullRequestReviewId: $pullRequestReviewId
      event: $event
      body: $body
    }) {
      pullRequestReview { id state }
    }
  }
`;
