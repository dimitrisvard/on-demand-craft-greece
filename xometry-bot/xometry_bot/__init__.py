"""Xometry auto-counteroffer pipeline for Microns Hub.

Scans the partner job board 7x/day, prices survivors as a buyer, and queues
human-gated counteroffers. Nothing is sent to Xometry without a dashboard click.
"""

__version__ = "0.1.0"
