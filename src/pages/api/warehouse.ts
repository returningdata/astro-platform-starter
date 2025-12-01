import type { APIRoute } from 'astro';

export const prerender = false;

const warehouseData = [
    {
        name: "2010 Trainee Vehicle",
        icon: "vehicle",
        items: [
            { name: "11cvpitrain", status: "available" },
            { name: "Spawn Code: 6653", status: "available" }
        ]
    },
    {
        name: "2013 Crown Victoria",
        icon: "vehicle",
        items: [
            { name: "legstanier", status: "available" },
            { name: "Spawn Code: 6643", status: "available" }
        ]
    },
    {
        name: "2016 Dodge Charger",
        icon: "vehicle",
        items: [
            { name: "legbuffalo", status: "available" },
            { name: "Spawn Code: 6644", status: "available" }
        ]
    },
    {
        name: "2016 Ford Explorer",
        icon: "vehicle",
        items: [
            { name: "legscout", status: "available" },
            { name: "Spawn Code: 6645", status: "available" }
        ]
    },
    {
        name: "2017 F150",
        icon: "vehicle",
        items: [
            { name: "legcaracar", status: "available" },
            { name: "Spawn Code: 6647", status: "available" }
        ]
    },
    {
        name: "2018 Dodge Charger",
        icon: "vehicle",
        items: [
            { name: "keith_bravadobuffpd", status: "available" },
            { name: "Spawn Code: 6654", status: "available" },
            { name: "Bulletproof", status: "available" }
        ]
    },
    {
        name: "2022 Ford Mustang Shelby GT500",
        icon: "vehicle",
        items: [
            { name: "taz_lcdom", status: "available" },
            { name: "Spawn Code: 6649", status: "available" },
            { name: "Bulletproof", status: "available" },
            { name: "Nitrous", status: "available" }
        ]
    },
    {
        name: "2023 Ram 1500",
        icon: "vehicle",
        items: [
            { name: "taz_23silverbi", status: "available" },
            { name: "Spawn Code: 6650", status: "available" }
        ]
    },
    {
        name: "2019 Corvette C7",
        icon: "vehicle",
        items: [
            { name: "polcoquette", status: "available" },
            { name: "Spawn Code: 6655", status: "available" }
        ]
    },
    {
        name: "AW139",
        icon: "firearm",
        items: [
            { name: "AW139", status: "available" },
            { name: "Spawn Code: 6656", status: "available" }
        ]
    },
    {
        name: "MD 500",
        icon: "communication",
        items: [
            { name: "buzzard2", status: "available" },
            { name: "Spawn Code: 6659", status: "available" }
        ]
    },
    {
        name: "INKAS Sentry",
        icon: "communication",
        items: [
            { name: "gurka", status: "available" },
            { name: "Spawn Code: 6660", status: "available" }
        ]
    },
    {
        name: "2023 SRT Hellfire",
        icon: "protection",
        items: [
            { name: "leghellfire", status: "available" },
            { name: "Spawn Code: 6646", status: "available" }
        ]
    },
    {
        name: "Blue Bird",
        icon: "investigation",
        items: [
            { name: "pbus", status: "available" },
            { name: "Spawn Code: 6670", status: "available" }
        ]
    }
];

export const GET: APIRoute = async () => {
    return new Response(JSON.stringify({ warehouse: warehouseData }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
};
