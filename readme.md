# OpenAI React App Deployer

This is a Node.js app that deploys a React app generated from OpenAI's GPT-3 API to an AWS S3 bucket. The app generates a React component based on a description of the app provided by the user, adds a Cypress test for the component, and deploys the resulting app to an S3 bucket.

## Requirements

- Node.js version 12 or higher
- An OpenAI API key
- An AWS S3 bucket with public read access

## Installation

1. Clone the repository:
2. Install dependencies:
3. Create a `.env` file in the root directory by copying .env-sample and adding your api key

## Usage

To use the app, run the following command:

node index.js <app_description>

Replace `<app_description>` with a short description of the app you want to generate, e.g. "App to manage a todo list".

The app will generate a React component based on the description and a Cypress test for the component. It will then create a new React app using `create-react-app`, copy the generated component into the app, install dependencies, build the app, and deploy it to a new S3 bucket.

You can view the deployed app at `https://<bucket_name>.s3.amazonaws.com/index.html`, where `<bucket_name>` is the name of the S3 bucket you deployed the app to.

**WARNING: Running this app will create a new React app, add code and resources to your AWS account, and deploy the app to an S3 bucket with public read access. Be sure to review the generated code and resources carefully before deploying, and consider using a separate AWS account or IAM user with restricted permissions for testing purposes. Remember to remove any AWS resources created by this app when you're done using it.**

## Using the Delete Script to Clean Buckets

The `delete_s3_buckets.sh` script helps you delete specific AWS S3 buckets and their contents using the AWS CLI. This is useful when you want to clean up the S3 buckets created by the OpenAI React App Deployer.

### Prerequisites

1. You must have the AWS CLI installed on your system. You can download and install it from the [official AWS CLI website](https://aws.amazon.com/cli/).
2. Ensure that your AWS CLI is configured with the appropriate access keys and region. You can use `aws configure` to set up your CLI.

### Running the Delete Script

1. Open a terminal and navigate to the root directory.

2. Make the script executable by running the following command: `bash delete-buckets.sh`

