#!/bin/sh

echo "Starting startup.sh.."
echo "0       */4     *       *       *       run-parts /etc/periodic/cron" >> /etc/crontabs/root
crontab -l
