# Harper Full Page/Partial Page Cache Application Template

This repo is a template for implementing full/partial page caching using a Harper application component.

You can visit the links below to learn more about Harper and application components:

- [Harper Application Component Github repo](https://github.com/HarperFast/application-template)
- [Harper Documentation](https://docs.harperdb.io/docs/developers/applications)



## Getting Started

### Prerequisites

Before cloning this repository, ensure Harper is installed on your local machine. If it's not already installed,
execute this in a terminal to install Harper.

```npm i -g harper``` 


### ***Installation***

1. ***Clone this repository to your local machine***


>>>> ```git clone <repository-url>```

2. ***Go to the project directory***

>>>```cd <repository-directory>```

3. ***Start Harper in your project directory by running*** 

>>>```harper dev .```


## Implementing the Caching Solution

To implement caching, you may want to modify the sourcing function located in the resource.js file. 

The class is responsible for fetching the web page content and storing it in a cache.

Follow the comments in the code for guidance on how to set it up.



## Example
    
***visit the following URL in the browser as an example of accessing a webpage through the cache***: 

``` http://localhost:9926/PageCache/solutions/distributed-applications```



## Learn more about caching with Harper:

- [Harper Application Caching Docs](https://docs.harperdb.io/docs/developers/applications/caching)
