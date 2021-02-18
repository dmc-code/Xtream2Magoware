#!/bin/sh

echo "Starting startup.sh.."
echo "0       */6     *       *       *       run-parts /etc/periodic/6hours" >> /etc/crontabs/root
crontab -l
