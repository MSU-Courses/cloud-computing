# !/bin/bash


# Configurable parameters
ALB_DNS=project-alb-952985005.us-east-1.elb.amazonaws.com
THREADS=10
SECONDS=60
TARGET="http://$ALB_DNS/load?seconds=$SECONDS"

# Load generation
echo "========================================="
echo " Starting load against: $TARGET"
echo " Threads: $THREADS"
echo "========================================="

for i in $(seq 1 $THREADS); do
    (
        while true; do
            curl -s "$TARGET" > /dev/null
        done
    ) &
done

echo "Load started. Press CTRL+C to stop."
wait