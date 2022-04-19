#!/bin/sh

echo "Starting startup.sh.."
echo "0       */2     *       *       *       run-parts /etc/periodic/2hours" >> /etc/crontabs/root
crontab -l
