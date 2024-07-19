+++
author = "Simon Schoof"
title = "The slightly more complex thingy: A CQRS/ES backend in Kotlin"
date = "2024-07-19"
description = "A CQRS/ES backend in Kotlin with Spring Boot, Spring events, and an embedded database"
tags = [
    "cqrs",
    "event-sourcing", 
    "kotlin",
    "spring-boot",
    "embedded-database"
]
draft = true
+++

# The slightly more complex thingy: A CQRS/ES backend in Kotlin



## Introduction

In this post, we will build an application using Kotlin, Spring Boot, Spring events, and an embedded database showcasing an Command Query Responsibility Segregation (CQRS) and Event Sourcing (ES) architecture. We will implement a simple CQRS/ES architecture to demonstrate how to structure a backend application with these concepts. The application builds upon the C# implementation of [Greg Young`s SimpleCQRS project][simplestpossiblething][<sup>[1](#ref-1)</sup>], but uses Kotlin and Spring Boot instead of C# and .NET and adds a (embedded) PostgreSQL database and Spring events to the mix. A frontend application is also part of the codebase, but is not the focus of this post. The frontend application is build using Kotlin Multiplatform Compose and is more of a proof of concept. For the domain side of the application we also follow the original SimpleCQRS project, and implement a simple inventory management system with only one aggregate root, the `InventoryItem`. The application is structured in a way that it can be easily extended with more aggregate roots, commands, events, and projections.

To include:
- Other implentations of CQRS/ES in Kotlin and production ready frameworks like Axon Framework and Marten
- Links to Domain Driven Design especially the blue book, the red book and patterns, principles and practices of domain driven design. Explaining aggregates, repositories, factories and domain events.
- Links to the original SimpleCQRS project and the C# implementation
- Links to the Kotlin Multiplatform Compose project
- Links to Arrow-kt for further functional programming in Kotlin for domain side of the application
- Explaining what is not included in the project like security, logging, monitoring, Rest API or GraphQL, etc.
- Testing is described in the next blog post 


* Concept and why of CQRS
* Concept and why of Event Sourcing
* Application structure and flow
  ** schematic diagram
* Technologies used
    ** Kotlin
    ** Spring Boot
    ** Spring events
    ** Embedded PostgreSQL database (embedded PostgreSQL database from zonky.io)
    ** Kotlin Multiplatform Compose
* Codebase structure
* Components of the codebase
  ** Command
  ** CommandHandler
  ** Event
  ** EventStore
  ** AggregateRepository
  ** AggregateRoot
  ** EventBus
    ** Publishing events and sending commands
  ** ReadModel
    ** Projections
    ** Querying the read model
  ** ReadModelFacade



## References

<a id="ref-1"></a>[1]: Gregory Young, "Simple CQRS example" [https://github.com/gregoryyoung/m-r/tree/master][simplestpossiblething]

[simplestpossiblething]: https://github.com/gregoryyoung/m-r/tree/master