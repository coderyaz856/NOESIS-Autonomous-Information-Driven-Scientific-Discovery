---
title: Noesis Scientific Lab Bridge
emoji: "🧪"
colorFrom: indigo
colorTo: cyan
sdk: docker
app_port: 7860
pinned: false
---

# Noesis Scientific Lab Bridge

Authenticated execution backend for the Noesis scientific-discovery demo.

This Space intentionally exposes no standalone user interface. Open the public
Noesis web application to submit a research question and inspect agent activity,
evidence, decisions, uncertainty, cost, and the resulting report. Direct Space
requests require the private bridge token and therefore return `401`.

Deployment and security instructions live in the source repository under
`deploy/huggingface/README.md`.
