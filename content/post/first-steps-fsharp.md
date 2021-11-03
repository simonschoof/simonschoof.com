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

To make it easier for me to code something in F#, I decided to set up a small project where I download some stats from my [yoga app](https://www.downdogapp.com/web) and plot them.  
In this project, I didn't want to deal with handling dependencies or structuring a large project. Also, the plots didn't necessarily need to be meaningful. The code for the project can be found [here](https://github.com/simonschoof/downdogstats). 

In the next few sections, I will cover the highlights and annoyances of my first steps with F#.

### Setup and F# Interactive

First off all the [setup under linux with  Visual Studio Code and Ionide](https://docs.microsoft.com/en-us/dotnet/fsharp/get-started/get-started-vscode) is a breeze. Nevertheless the [smoothness of the installation of .NET](https://docs.microsoft.com/en-us/dotnet/core/install/linux) depends on your linux distribution.

One of the [dont´s](https://fsharpforfunandprofit.com/learning-fsharp/#dos-and-donts) Scott Wlashin recommends is to not use a debugger. Instead we should rely on the compiler to "debug" our F# code. For this any .NET SDK ships with [F# Interactive](https://docs.microsoft.com/en-us/dotnet/fsharp/tools/fsharp-interactive/) as a [REPL (Read, Evaluate, Print Loop)](https://en.wikipedia.org/wiki/Read%E2%80%93eval%E2%80%93print_loop) for the F# language. Within Visual Studio Code you then can add a F# script file and [send the content of the script via Alt+Enter to the F# Interactive](https://docs.microsoft.com/en-us/dotnet/fsharp/get-started/get-started-vscode).
The common development workflow then is to develop your code with a script file and F# Interactive and afterwards integrate it in your existing project. To allow scripting from existing projects [Ionide](https://ionide.io/) comes with a feature to generate references for F# Interactive so that one can get access the code of your existing project. This is also how I developed my project. First start with a script. Write some F# code. Let the compiler check if everything is correct. Test it with F# Interactive. Eventually move the code parts of the script into my console application project. 

Overall I can say that I like the used development workflow. It feels intuitive, but is completely from my workflow at work. It also helps to develop code incrementally in (very) small steps.

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

**Don’t create classes**
**Do create lots of “little types**

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

```fsharp

```

```fsharp
let countById collection : seq<_> = collection |> Seq.countBy id
```

**Do use pipe (|>) and composition (>>)**


**Do understand how partial application works, and try to become comfortable withpoint-free (tacit) style**

  - dos and donts
    - also binding partial application
    - easy generic extension of existing collections

### Helpful Libraries

  - secret management
   - documentation for fsharp not as much as java or c# (not quantified --> just a feeling)
  - integration of c3 .net libs -->
  - argu for argument parsing

### Summary and Conclusion

- type provider
- annoyances:
  - type initialisation exception -> difficult to find out what happend

- Easy to setup. Runs smooth under linux. Dos and donts were easy to follow especially after working with kotlin at work
Feels like if it compiles it works.
Files must be in order.




