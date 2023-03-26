#!/bin/bash

# List all the S3 buckets and filter the ones starting with "open-ai-api-test-"
buckets=$(aws s3api list-buckets --query 'Buckets[?starts_with(Name, `open-ai-api-test-`)].Name' --output text)

# Iterate through the filtered buckets and delete their contents
for bucket in $buckets; do
    echo "Deleting contents of bucket: $bucket"
    aws s3 rm s3://$bucket/ --recursive

    echo "Deleting bucket: $bucket"
    aws s3api delete-bucket --bucket $bucket
done
