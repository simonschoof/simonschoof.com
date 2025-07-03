+++
draft = true
author = "Simon Schoof"
title = "Do you even test?"
date = "2025-07-03"
description = "Testing a Spring Boot application with a domain core and an embedded database"
tags = [
    "domain-driven-design", 
    "kotlin",
    "spring-boot",
    "embedded-database",
    "testing",
    "unit-testing"
]
series = "cqrs/es backend and testing"
references = [
    { title = "Test pyramid", url = "https://martinfowler.com/bliki/TestPyramid.html" },
    { title = "Unit tests", url = "https://martinfowler.com/bliki/UnitTest.html" }
]
+++

 This post is the second part of a of a two-part series, in which we build a CQRS/ES backend application with Kotlin and Spring Boot. This part focuses on how to test the different parts of the application and how we can write tests which are integrating a database or a REST controller.

{{< series "cqrs/es backend and testing" >}} 


## Introduction

* Test pyramid 
  * Tests should fit to your architecture
  * 
* Type of tests
 * Unit tests
 * State vs. behavior tests
 * Integration tests
 * End-to-end tests

## Testing from the inside out

