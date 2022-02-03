+++
author = "Simon Schoof"
title = "First Steps in F#"
date = "2021-10-06"
description = "My first steps with F#"
tags = [
    "functional programming", 
    "fsharp",
    "dotnet"
]
draft = true
+++

I have wanted to dive into functional programming for a long time now. In my first job as a professional developer, I developed with C# and .NET, and I'm still a fan of C# and .NET. Especially after [.NET officially set its sights on the Linux ecosystem in 2016](https://devblogs.microsoft.com/dotnet/announcing-net-core-1-0/). I also have a bias towards [statically typed languages](https://en.wikipedia.org/wiki/Type_system#Static_type_checking) with [type inference](https://en.wikipedia.org/wiki/Type_inference). With this in mind, it was natural for me to choose F# as the language for my first steps into functional programming.

To learn F# I rely heavily on the [awesome blog of Scott Wlashin](https://fsharpforfunandprofit.com).
I especially try to follow his recommended [dos and dont´s](https://fsharpforfunandprofit.com/learning-fsharp/#dos-and-donts). 

To make it easier for me to code something in F#, I decided to set up a small project where I download some stats from my yoga app [Downdowg](https://www.downdogapp.com/web) and plot them.  
In this project, I didn't want to deal with handling dependencies or structuring a large project. Also, the plots didn't necessarily need to be meaningful. The code for the project can be found [here](https://github.com/simonschoof/downdogstats). 

In the next few sections, I will go over the setup and structure of the project and will cover the highlights and annoyances of my first steps with F#.

### Setup and F# Interactive

First off all the [setup under linux with  Visual Studio Code and Ionide](https://docs.microsoft.com/en-us/dotnet/fsharp/get-started/get-started-vscode) is a breeze. Nevertheless the [smoothness of the installation of .NET](https://docs.microsoft.com/en-us/dotnet/core/install/linux) depends on your linux distribution.

One of the [dont´s](https://fsharpforfunandprofit.com/learning-fsharp/#dos-and-donts) Scott Wlashin recommends is to not use a debugger. Instead we should rely on the compiler to "debug" our F# code. For this any .NET SDK ships with [F# Interactive](https://docs.microsoft.com/en-us/dotnet/fsharp/tools/fsharp-interactive/) as a [REPL (Read, Evaluate, Print Loop)](https://en.wikipedia.org/wiki/Read%E2%80%93eval%E2%80%93print_loop) for the F# language. Within Visual Studio Code you then can add a F# script file and [send the content of the script via Alt+Enter to the F# Interactive](https://docs.microsoft.com/en-us/dotnet/fsharp/get-started/get-started-vscode).
The common development workflow then is to develop your code with a script file and F# Interactive and afterwards integrate it in your existing project. To allow scripting from existing projects [Ionide](https://ionide.io/) comes with a feature to generate references for F# Interactive so that one can get access the code of your existing project. This is also how I developed my project. First start with a script. Write some F# code. Let the compiler check if everything is correct. Test it with F# Interactive. Eventually move the code parts of the script into my console application project. 

Overall I can say that I like the used development workflow. It feels intuitive, but is completely from my workflow at work. It also helps to develop code incrementally in (very) small steps.

### Project description

The basic idea of [the project](https://github.com/simonschoof/downdogstats) is to download my yoga stats from the Downdog app as json, parse them with the [F# json type provider](http://fsprojects.github.io/FSharp.Data/library/JsonProvider.html), convert them into a easily plottable dataset and finally be able to plot two types of diagrams from the data. The first chart should show the frequency of the lessons I took, and the second chart should show the music charts of all my lessons. 

{{< figure2 src="images/downdog_simple_workflow.svg" class="downdog-workflow" caption="Simple project workflow" attrrel="noopener noreferrer" >}} 


#### Results

{{< figure2 src="images/downdog_yoga_lessons.png" class="downdog-charts" caption="Plot 1: Downdog lessons taken (x = date [d] , y = duration [min])" attrrel="noopener noreferrer" >}} 

{{< figure2 src="images/downdog_music_charts_top_10.png" class="downdog-charts" caption="Plot 2: Downdog top ten music charts" attrrel="noopener noreferrer" >}} 

### Dos and Dont's

As I have said already in the beginning I wanted to take into account Scott Wlashins [dos and dont´s](https://fsharpforfunandprofit.com/learning-fsharp/#dos-and-donts) for learnig F#. In the next step we will have a closer look at all of them except for the don´t use the debugger advise, which we addressed above.

**Don’t use the mutable keyword**

This one was easy to achieve as I use Kotlin at work and Kotlin also [dinstiguishes between mutable and immutable values](https://www.kotlintutorialblog.com/kotlin-var-vs-val/). I had to use mutable when I was working with the AWS SDK for .NET  where I needed to set a value after the creation of class.

```fsharp
let secretName = "secret";
let mutable secretValueRequest = GetSecretValueRequest()
secretValueRequest.SecretId <- secretName
```

**Don’t use for loops or if-then-else**

I didn`t! As recommeded I used pattern matching instead. Also here pattern matching is avaible in Kotlin.

```fsharp
let obtainSpotifyUri (downDogSpotifyUri: string option) =
        match downDogSpotifyUri with
        | None -> None
        | Some s -> Some (new UriBuilder(s)).Uri
```

**Don’t use “dot notation”**

I tried to avoid dot notation, but had to use it in some parts, especially where I had to deal with external C# libraries that accessed the properties of the provided types.

**Don’t create classes**

I have not created a single class myself. :smile:

**Do create lots of “little types**

I tried to use (little) types for each part of my "domain". 

```fsharp
type SongId = string
type Artist = string
type Title = string
type SpotifyUrl = Uri option

type Song =
    { id: SongId
      artist: Artist
      title: Title
      spotifyUrl: SpotifyUrl }
```

**Do understand the list and seq types**

Since [list and sequences are also available in Kotlin](https://kotlinlang.org/docs/sequences.html), this was easy to achieve.

```fsharp
let obtainYogaMusicCharts (historyItems: array<DownDogHistory.Item>) =
    historyItems
    |> Array.collect (fun element -> element.Songs)
    |> Array.map obtainSong
    |> countById
    |> Seq.sortByDescending (fun (_, b) -> b)
    |> Seq.toList
```

It was also nice to add a generic extension for sequences to add a count by id functionality.

```fsharp
let countById collection : seq<_> = collection |> Seq.countBy id
```

**Do use pipe (|>) and composition (>>)**

As we saw in "Understanding the List and Seq Types", I have used the pipe operator quite extensively. I also managed to use the
composition operator once. 

```fsharp
let obtainLessonDurationFromSelectors =
    obtainSelectorValue "LENGTH"
    >> obtainLessonDuration
```

**Do understand how partial application works, and try to become comfortable with point-free (tacit) style**

The above example also illustrates the use of a partial application where `LENGTH` is partially applied to the `obtainSelectorValue` function. But I have not yet managed to familiarize myself with the point-free (implicit) style.

### Helpful libraries/services

During the development process, I found and used some nice libraries which helped me with various aspects of my application that I didn't want to code myself.


**Secret management**

First of all, I don't like to store secrets in my repositories. Not even encrypted ones. I've still managed to check in some secrets into my repos, even with encrypted secrets. You could prevent this with tools like [talisman](https://github.com/thoughtworks/talisman), but I prefer not to store secrets at all. Although this is probably not possible for all projects, I try to use secret management services.
Before [secrethub](https://secrethub.io/) was bought out by 1password, they offered a free plan for developers that is now no longer available. Still, integration was relatively easy:


```fsharp
open SecretHub
   let resolveSecret = 
       let secretHubClient = new Client()
       secretHubClient.Resolve("secrethub://path/to/secret")
```

Due to the Secrethub acquisition, I moved to AWS where the API is more general and therefore more complex to integrate:

```fsharp
open Amazon
    open Amazon.SecretsManager
    open Amazon.SecretsManager.Model
    open System.Threading

    let resolveSecret =  
        
        let awsSecretManagerClient = new AmazonSecretsManagerClient(RegionEndpoint.EUCentral1)
        
        let secretName = "/path/to/secret";
        let mutable secretValueRequest = GetSecretValueRequest()
        secretValueRequest.SecretId <- secretName

        let asyncSecrets = async {
            let! result = awsSecretManagerClient.GetSecretValueAsync(secretValueRequest, CancellationToken(false))
                        |> Async.AwaitTask  
            return result
        } 

        let secretResolved = Async.RunSynchronously(asyncSecrets)
        secretResolved.SecretString
```

**Argument parsing**

Since the application was to be a console application, I wanted to be able to parse command line arguments. For this I found [Argu](http://fsprojects.github.io/Argu/) very helpful.

**Date and time**

No .NET project that works with date and time should do without [nodatime](https://nodatime.org/). 
For those who need to work with date and time, I recommend this [talk](https://www.youtube.com/watch?v=saeKBuPewcU) by [John Skeet](https://codeblog.jonskeet.uk/).

**Plotting**

Last but not least, I used [XPlot](https://fslab.org/XPlot/), which is powered by [Plotly](https://plot.ly/) and [Google Charts](https://developers.google.com/chart/), to create the charts for my Downdog statistics. In the future, I will upgrade to [Plotly.NET](https://plotly.net/) as recommended by XPlot.

### Summary

- Easy to setup. 
- Runs smooth under linux. 
- Dos and donts were easy to follow especially after working with kotlin at work
-  Feels like some could write fewer test because of the type system.
- Development workflow with repl and script
- files must be in order
- I had a bt of a different idea on how the F# json type provider works. 
- documentation for fsharp not as extensive as for c#
- Some struggle to integration of C# .net libs e.g. AWS -> lack of examples or some mysterious type initialisation exception which which also disappeared misteriously never found out what happened

### TL;DR

First successful attempt to write F# and also wrote my first blog article about it. Great Success!



