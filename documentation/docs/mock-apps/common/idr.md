---
sidebar_position: 31
title: IDR
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `IDR` object contains configuration for the [Identity Resolver Service](/docs/mock-apps/dependent-services/identity-resolution-service), which is used to create and manage resolvable links for the UNTP credentials.

## Definition

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| dlrAPIUrl | Yes | URL for the Identity Resolver API | String |
| dlrAPIKey | No | API key for the Identity Resolver | String |